/**
 * IPFS storage client.
 *
 * IPFS_MODE=kubo  → talks to a running IPFS (Kubo) daemon over its HTTP API (IPFS_URL,
 *                   default http://127.0.0.1:5001).
 * IPFS_MODE=mock  → (default) content-addressed store on local disk (IPFS_MOCK_DIR,
 *                   default ./storage/ipfs). CIDs are CIDv0-style ("Qm…") strings derived
 *                   from the SHA-256 of the content, so identical content → identical CID.
 */

import axios from "axios";
import FormData from "form-data";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type IpfsMode = "mock" | "kubo";

export function getIpfsMode(): IpfsMode {
    return process.env.IPFS_MODE?.toLowerCase() === "kubo" ? "kubo" : "mock";
}

function getIpfsUrl(): string {
    return (process.env.IPFS_URL ?? "http://127.0.0.1:5001").replace(/\/+$/, "");
}

function getMockDir(): string {
    return path.resolve(process.env.IPFS_MOCK_DIR ?? path.join(process.cwd(), "storage", "ipfs"));
}

const IPFS_TIMEOUT_MS = Number(process.env.IPFS_TIMEOUT_MS ?? 30000);

// ---------------------------------------------------------------------------
// CIDv0 (base58btc-encoded sha2-256 multihash) — used by the mock store
// ---------------------------------------------------------------------------
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Buffer): string {
    let num = BigInt("0x" + bytes.toString("hex"));
    let out = "";
    while (num > 0n) {
        out = BASE58_ALPHABET[Number(num % 58n)] + out;
        num /= 58n;
    }
    for (const b of bytes) {
        if (b !== 0) break;
        out = "1" + out;
    }
    return out;
}

export function cidFromSha256(sha256Hex: string): string {
    return base58Encode(Buffer.concat([Buffer.from([0x12, 0x20]), Buffer.from(sha256Hex, "hex")]));
}

function assertSafeCid(cid: string): void {
    if (!/^[A-Za-z0-9]+$/.test(cid)) {
        throw new Error(`Invalid CID "${cid}"`);
    }
}

/** Looks like an IPFS CID (v0 "Qm…" or v1 "b…") */
export function looksLikeCid(value: string): boolean {
    return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) || /^b[a-z2-7]{50,}$/.test(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add raw bytes to IPFS and return the CID */
export async function addBuffer(data: Buffer, fileName = "data"): Promise<string> {
    if (getIpfsMode() === "kubo") {
        const form = new FormData();
        form.append("file", data, { filename: fileName });
        return kuboAdd(form);
    }

    const sha = crypto.createHash("sha256").update(data).digest("hex");
    const cid = cidFromSha256(sha);
    const dir = getMockDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, cid);
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    return cid;
}

/** Add a file from disk to IPFS (streamed) and return the CID */
export async function addFile(filePath: string, sha256Hex: string): Promise<string> {
    if (getIpfsMode() === "kubo") {
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath), { filename: path.basename(filePath) });
        return kuboAdd(form);
    }

    const cid = cidFromSha256(sha256Hex);
    const dir = getMockDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, cid);
    if (!fs.existsSync(target)) fs.copyFileSync(filePath, target);
    return cid;
}

/** Fetch content by CID */
export async function cat(cid: string): Promise<Buffer> {
    assertSafeCid(cid);
    if (getIpfsMode() === "kubo") {
        const res = await axios.post(`${getIpfsUrl()}/api/v0/cat`, null, {
            params: { arg: cid },
            responseType: "arraybuffer",
            timeout: IPFS_TIMEOUT_MS,
        });
        return Buffer.from(res.data);
    }

    const target = path.join(getMockDir(), cid);
    if (!fs.existsSync(target)) {
        throw new Error(`CID ${cid} not found in mock IPFS store`);
    }
    return fs.readFileSync(target);
}

async function kuboAdd(form: FormData): Promise<string> {
    const res = await axios.post(`${getIpfsUrl()}/api/v0/add`, form, {
        params: { pin: true, "cid-version": 0 },
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: IPFS_TIMEOUT_MS,
    });
    // Kubo returns one JSON object per line; the last line is the root object
    const body = typeof res.data === "string" ? res.data.trim().split("\n").pop()! : JSON.stringify(res.data);
    const parsed = JSON.parse(body);
    if (!parsed.Hash) throw new Error("IPFS add returned no Hash");
    return parsed.Hash as string;
}
