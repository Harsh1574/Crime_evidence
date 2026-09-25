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
export type LedgerMode = "mock" | "fabric";
export declare function getLedgerMode(): LedgerMode;
export interface LedgerWrite {
    assetId: string;
    caseId: string;
    cid: string;
    payloadHash: string;
    version: number;
    isNew: boolean;
}
export interface LedgerReceipt {
    txId: string;
    blockNumber: number;
    mode: LedgerMode;
}
export interface LedgerAsset {
    assetId: string;
    caseId: string | null;
    cid: string | null;
    version: number | null;
    txId: string | null;
    payloadHash: string | null;
}
export declare function computeBlockHash(block: {
    blockNumber: number;
    prevHash: string;
    txId: string;
    assetId: string;
    function: string;
    cid: string | null;
    payloadHash: string;
}): string;
/** Create or update the ledger asset that points at the evidence metadata CID */
export declare function putAsset(write: LedgerWrite): Promise<LedgerReceipt>;
/** Remove the asset from the world state (the transaction itself stays on the ledger) */
export declare function deleteAsset(assetId: string): Promise<LedgerReceipt>;
/** Read the current state of an asset from the ledger */
export declare function readAsset(assetId: string): Promise<LedgerAsset | null>;
/** Every indexed ledger transaction for an asset, oldest first */
export declare function getAssetHistory(assetId: string): Promise<{
    function: string;
    id: string;
    createdAt: Date;
    txId: string;
    blockNumber: number;
    mode: string;
    assetId: string;
    cid: string | null;
    payloadHash: string;
    prevHash: string;
    blockHash: string;
}[]>;
/**
 * Verify the hash links of every block that touches this asset: each block's
 * hash must be correct and its prevHash must equal the preceding block's hash.
 */
export declare function verifyAssetChain(assetId: string): Promise<{
    valid: boolean;
    blocksChecked: number;
    brokenAt?: number;
}>;
//# sourceMappingURL=ledger.d.ts.map