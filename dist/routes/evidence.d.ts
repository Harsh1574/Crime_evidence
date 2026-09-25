/**
 * Evidence management routes — CRUD, search, integrity verification,
 * version history, reports and file download.
 *
 * Evidence statuses are ALWAYS validated against demo_config.json.
 * If a status is renamed in the config, the API immediately accepts
 * the new name and rejects the old one.
 *
 * Every change is anchored: metadata → IPFS → ledger (see services/evidence.ts).
 */
import multer from "multer";
export declare const upload: multer.Multer;
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=evidence.d.ts.map