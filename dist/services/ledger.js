/**
 * Ledger client — records evidence asset pointers (IPFS CIDs) on a blockchain.
 *
 * LEDGER_MODE=fabric → submits transactions to a Hyperledger Fabric network through
 *                      fabric-network (install it with `npm install fabric-network`).
 *                      Uses the asset-transfer "basic" chaincode layout:
 *                        ID = evidence number, Color = caseId, Size = version,
 *                        Owner = metadata CID, AppraisedValue = 0
 * LEDGER_MODE=mock   → (default) an append-only, hash-linked ledger stored in the
 *                      LedgerTransaction table. Every block stores the hash of the
 *                      previous block, so any edit to history breaks the chain.
 *
 * In both modes every transaction is indexed in LedgerTransaction so reports and
 * integrity checks can reference real transaction IDs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
export function getLedgerMode() {
    return process.env.LEDGER_MODE?.toLowerCase() === "fabric" ? "fabric" : "mock";
}
const GENESIS_HASH = "0".repeat(64);
const LEDGER_LOCK_KEY = 7461001; // pg advisory lock id serialising block appends
function sha256(data) {
    return crypto.createHash("sha256").update(data, "utf-8").digest("hex");
}
export function computeBlockHash(block) {
    return sha256([block.blockNumber, block.prevHash, block.txId, block.assetId, block.function, block.cid ?? "", block.payloadHash].join("|"));
}
/** Append a transaction to the local ledger index (hash-linked to the previous block) */
async function appendBlock(entry) {
    const mode = getLedgerMode();
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`;
        const last = await tx.ledgerTransaction.findFirst({ orderBy: { blockNumber: "desc" } });
        const blockNumber = (last?.blockNumber ?? 0) + 1;
        const prevHash = last?.blockHash ?? GENESIS_HASH;
        const txId = entry.txId ?? sha256(`${prevHash}|${entry.payloadHash}|${Date.now()}|${crypto.randomBytes(16).toString("hex")}`);
        const blockHash = computeBlockHash({
            blockNumber,
            prevHash,
            txId,
            assetId: entry.assetId,
            function: entry.fn,
            cid: entry.cid,
            payloadHash: entry.payloadHash,
        });
        await tx.ledgerTransaction.create({
            data: {
                txId,
                blockNumber,
                assetId: entry.assetId,
                function: entry.fn,
                cid: entry.cid,
                payloadHash: entry.payloadHash,
                prevHash,
                blockHash,
                mode,
            },
        });
        return { txId, blockNumber, mode };
    });
}
// ---------------------------------------------------------------------------
// Fabric gateway (lazy, cached)
// ---------------------------------------------------------------------------
let fabricContractPromise = null;
async function getFabricContract() {
    if (!fabricContractPromise) {
        fabricContractPromise = (async () => {
            const moduleName = "fabric-network";
            let fabric;
            try {
                fabric = await import(moduleName);
            }
            catch {
                throw new Error('LEDGER_MODE=fabric requires the "fabric-network" package. Run: npm install fabric-network');
            }
            const ccpPath = path.resolve(process.env.CCP_PATH ?? "connection-org1.json");
            const ccp = JSON.parse(fs.readFileSync(ccpPath, "utf-8"));
            const wallet = await fabric.Wallets.newFileSystemWallet(path.resolve(process.env.WALLET_PATH ?? "wallet"));
            const identity = process.env.FABRIC_IDENTITY ?? "appUser";
            if (!(await wallet.get(identity))) {
                throw new Error(`Fabric identity "${identity}" not found in wallet. Run enrollAdmin.js / registerUser.js first.`);
            }
            const gateway = new fabric.Gateway();
            await gateway.connect(ccp, {
                wallet,
                identity,
                discovery: { enabled: true, asLocalhost: process.env.FABRIC_AS_LOCALHOST !== "false" },
            });
            const network = await gateway.getNetwork(process.env.CHANNEL_NAME ?? "crimechannel");
            return network.getContract(process.env.CHAINCODE_NAME ?? "basic");
        })().catch((err) => {
            fabricContractPromise = null; // allow retry on next call
            throw err;
        });
    }
    return fabricContractPromise;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/** Create or update the ledger asset that points at the evidence metadata CID */
export async function putAsset(write) {
    const fn = write.isNew ? "CreateAsset" : "UpdateAsset";
    if (getLedgerMode() === "fabric") {
        const contract = await getFabricContract();
        const transaction = contract.createTransaction(fn);
        await transaction.submit(write.assetId, write.caseId, String(write.version), write.cid, "0");
        return appendBlock({ txId: transaction.getTransactionId(), assetId: write.assetId, fn, cid: write.cid, payloadHash: write.payloadHash });
    }
    return appendBlock({ assetId: write.assetId, fn, cid: write.cid, payloadHash: write.payloadHash });
}
/** Remove the asset from the world state (the transaction itself stays on the ledger) */
export async function deleteAsset(assetId) {
    if (getLedgerMode() === "fabric") {
        const contract = await getFabricContract();
        const transaction = contract.createTransaction("DeleteAsset");
        await transaction.submit(assetId);
        return appendBlock({ txId: transaction.getTransactionId(), assetId, fn: "DeleteAsset", cid: null, payloadHash: GENESIS_HASH });
    }
    return appendBlock({ assetId, fn: "DeleteAsset", cid: null, payloadHash: GENESIS_HASH });
}
/** Read the current state of an asset from the ledger */
export async function readAsset(assetId) {
    const latest = await prisma.ledgerTransaction.findFirst({
        where: { assetId },
        orderBy: { blockNumber: "desc" },
    });
    if (getLedgerMode() === "fabric") {
        const contract = await getFabricContract();
        let raw;
        try {
            raw = await contract.evaluateTransaction("ReadAsset", assetId);
        }
        catch (err) {
            if (/does not exist/i.test(err.message ?? ""))
                return null;
            throw err;
        }
        const asset = JSON.parse(raw.toString("utf-8"));
        return {
            assetId: asset.ID ?? assetId,
            caseId: asset.Color ?? null,
            cid: asset.Owner ?? null,
            version: asset.Size !== undefined ? Number(asset.Size) : null,
            txId: latest?.txId ?? null,
            payloadHash: latest?.cid === asset.Owner ? latest?.payloadHash ?? null : null,
        };
    }
    if (!latest || latest.function === "DeleteAsset")
        return null;
    return {
        assetId,
        caseId: null,
        cid: latest.cid,
        version: null,
        txId: latest.txId,
        payloadHash: latest.payloadHash,
    };
}
/** Every indexed ledger transaction for an asset, oldest first */
export async function getAssetHistory(assetId) {
    return prisma.ledgerTransaction.findMany({
        where: { assetId },
        orderBy: { blockNumber: "asc" },
    });
}
/**
 * Verify the hash links of every block that touches this asset: each block's
 * hash must be correct and its prevHash must equal the preceding block's hash.
 */
export async function verifyAssetChain(assetId) {
    const blocks = await getAssetHistory(assetId);
    for (const block of blocks) {
        if (computeBlockHash(block) !== block.blockHash) {
            return { valid: false, blocksChecked: blocks.length, brokenAt: block.blockNumber };
        }
        const prev = block.blockNumber === 1
            ? null
            : await prisma.ledgerTransaction.findUnique({ where: { blockNumber: block.blockNumber - 1 } });
        const expectedPrev = prev?.blockHash ?? GENESIS_HASH;
        if (block.prevHash !== expectedPrev) {
            return { valid: false, blocksChecked: blocks.length, brokenAt: block.blockNumber };
        }
    }
    return { valid: true, blocksChecked: blocks.length };
}
//# sourceMappingURL=ledger.js.map