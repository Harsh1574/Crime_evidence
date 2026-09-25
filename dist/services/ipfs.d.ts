/**
 * IPFS storage client.
 *
 * IPFS_MODE=kubo  → talks to a running IPFS (Kubo) daemon over its HTTP API (IPFS_URL,
 *                   default http://127.0.0.1:5001).
 * IPFS_MODE=mock  → (default) content-addressed store on local disk (IPFS_MOCK_DIR,
 *                   default ./storage/ipfs). CIDs are CIDv0-style ("Qm…") strings derived
 *                   from the SHA-256 of the content, so identical content → identical CID.
 */
export type IpfsMode = "mock" | "kubo";
export declare function getIpfsMode(): IpfsMode;
export declare function cidFromSha256(sha256Hex: string): string;
/** Looks like an IPFS CID (v0 "Qm…" or v1 "b…") */
export declare function looksLikeCid(value: string): boolean;
/** Add raw bytes to IPFS and return the CID */
export declare function addBuffer(data: Buffer, fileName?: string): Promise<string>;
/** Add a file from disk to IPFS (streamed) and return the CID */
export declare function addFile(filePath: string, sha256Hex: string): Promise<string>;
/** Fetch content by CID */
export declare function cat(cid: string): Promise<Buffer>;
//# sourceMappingURL=ipfs.d.ts.map