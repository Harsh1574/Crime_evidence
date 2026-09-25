/**
 * Evidence report (PDF) — details, live integrity check, file hashes, IPFS CIDs,
 * chain of custody, version history and the ledger transactions for the asset.
 */
import { Actor } from "./evidence.js";
export declare function generateEvidenceReport(evidenceId: string, generatedBy: Actor): Promise<{
    buffer: Buffer;
    fileName: string;
}>;
//# sourceMappingURL=report.d.ts.map