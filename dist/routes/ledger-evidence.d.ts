/**
 * Ledger-style evidence API — the contract from the "Crime Evidence Management - Backend"
 * spec, served at /api/evidence:
 *
 *   POST   /api/evidence                         create (metadata → IPFS, CID → ledger)
 *   POST   /api/evidence/bulk                    bulk create
 *   GET    /api/evidence                         search & filter (caseId, status, officer, dates, search, paging)
 *   GET    /api/evidence/:id                     by evidence ID, UUID or IPFS CID (ledger + IPFS metadata)
 *   PUT    /api/evidence/:id                     update metadata (new IPFS doc, ledger pointer updated)
 *   POST   /api/evidence/:id/status              status update
 *   GET    /api/evidence/:id/chain-of-custody    custody history
 *   POST   /api/evidence/:id/chain-of-custody    add custody entry (starts a transfer to toOfficer)
 *   DELETE /api/evidence/bulk                    bulk delete
 *   DELETE /api/evidence/:id                     delete
 *
 * All endpoints require a Bearer token (see /api/auth/login) and use the same
 * service layer as /api/v1/evidence. Other /api/evidence/:id/* paths fall through
 * to the v1 routers (comments, versions, report, download, …).
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=ledger-evidence.d.ts.map