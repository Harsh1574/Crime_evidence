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

import { Router, Request, Response } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import {
    buildEvidenceSearchWhere,
    createEvidence,
    deleteEvidence,
    findEvidenceId,
    initiateTransfer,
    removeUploadedFiles,
    storeUploadedFiles,
    updateEvidence,
    UploadedFile,
} from "../services/evidence.js";
import * as ipfs from "../services/ipfs.js";
import * as ledger from "../services/ledger.js";
import { audit } from "../services/audit.js";
import { upload } from "./evidence.js";

const router = Router();

const LIST_INCLUDE = {
    collectedBy: { select: { id: true, username: true, fullName: true } },
    currentCustodian: { select: { id: true, username: true, fullName: true } },
} as const;

type EvidenceRow = Awaited<ReturnType<typeof loadEvidence>>;

async function loadEvidence(id: string) {
    return prisma.evidence.findUnique({ where: { id }, include: LIST_INCLUDE });
}

/** Evidence as described by the spec's data schema, plus ledger/IPFS pointers */
function toLedgerView(ev: NonNullable<EvidenceRow>) {
    return {
        evidenceId: ev.evidenceNumber ?? ev.id,
        systemId: ev.id,
        caseId: ev.caseId,
        description: ev.description,
        officerName: ev.officerName ?? ev.collectedBy.fullName,
        timestamp: ev.createdAt.toISOString(),
        status: ev.status.toUpperCase(),
        type: ev.type,
        location: ev.location,
        currentCustodian: ev.currentCustodian.fullName,
        locked: ev.locked,
        fileHash: ev.fileHash,
        metadataHash: ev.metadataHash,
        cid: ev.ipfsCid,
        txId: ev.ledgerTxId,
        anchorStatus: ev.anchorStatus,
        version: ev.version,
    };
}

function toCreateInput(body: Record<string, any>, hasFile: boolean) {
    return {
        evidenceNumber: body.evidenceId,
        caseId: body.caseId,
        description: body.description,
        officerName: body.officerName ?? null,
        type: body.type ?? (hasFile ? "Digital" : "Physical"),
        location: body.location ?? "Not specified",
        collectionDate: body.collectionDate ?? new Date().toISOString(),
        status: body.status,
        tags: body.tags,
        officerNotes: body.officerNotes ?? body.notes ?? null,
    };
}

async function idOr404(req: Request, res: Response): Promise<string | null> {
    const id = await findEvidenceId(req.params.id as string);
    if (!id) res.status(404).json({ error: `Evidence "${req.params.id}" not found (tried evidence ID, UUID and IPFS CID).` });
    return id;
}

// ---------------------------------------------------------------------------
// POST /api/evidence — create (JSON, or multipart with an optional file)
// ---------------------------------------------------------------------------
router.post("/", authenticate, requirePermission("register_evidence"), upload.any(), async (req: Request, res: Response) => {
    const uploaded = (req.files as UploadedFile[] | undefined) ?? [];
    try {
        const stored = await storeUploadedFiles(uploaded);
        const { evidence, anchoring } = await createEvidence(toCreateInput(req.body, stored.length > 0), req.user!, stored);
        res.status(201).json({
            success: true,
            evidenceId: evidence!.evidenceNumber,
            cid: anchoring.cid,
            txId: anchoring.txId,
            metadataHash: anchoring.metadataHash,
            anchorStatus: anchoring.anchorStatus,
            evidence: toLedgerView((await loadEvidence(evidence!.id))!),
        });
    } catch (err: any) {
        removeUploadedFiles(uploaded);
        sendError(res, err, "Failed to create evidence");
    }
});

// ---------------------------------------------------------------------------
// POST /api/evidence/bulk — Body: { evidenceList: [...] }
// ---------------------------------------------------------------------------
router.post("/bulk", authenticate, requirePermission("register_evidence"), async (req: Request, res: Response) => {
    try {
        const list = req.body?.evidenceList;
        if (!Array.isArray(list) || list.length === 0) {
            res.status(400).json({ error: "evidenceList array is required" }); return;
        }
        if (list.length > 50) { res.status(400).json({ error: "Maximum 50 items per request" }); return; }

        const results = [];
        for (const item of list) {
            try {
                const { evidence, anchoring } = await createEvidence(toCreateInput(item ?? {}, false), req.user!);
                results.push({ success: true, evidenceId: evidence!.evidenceNumber, cid: anchoring.cid, txId: anchoring.txId });
            } catch (err: any) {
                results.push({ success: false, evidenceId: item?.evidenceId ?? null, error: err.message });
            }
        }
        const successful = results.filter((r) => r.success).length;
        res.status(successful > 0 ? 201 : 400).json({ results, successful, failed: results.length - successful });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to bulk create evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/evidence/bulk — Body: { evidenceIds: [...] }
// ---------------------------------------------------------------------------
router.delete("/bulk", authenticate, requirePermission("delete_evidence"), async (req: Request, res: Response) => {
    try {
        const ids = req.body?.evidenceIds;
        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: "evidenceIds array is required" }); return;
        }
        const results = [];
        for (const ref of ids) {
            try {
                const id = await findEvidenceId(String(ref));
                if (!id) { results.push({ evidenceId: ref, success: false, error: "Evidence not found." }); continue; }
                const deleted = await deleteEvidence(id);
                await audit(req, { action: "EVIDENCE_DELETED", entityType: "Evidence", entityId: id, details: deleted });
                results.push({ evidenceId: ref, success: true, txId: deleted.ledgerTxId });
            } catch (err: any) {
                results.push({ evidenceId: ref, success: false, error: err.message });
            }
        }
        const successful = results.filter((r) => r.success).length;
        res.json({ results, successful, failed: results.length - successful });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to bulk delete evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/evidence — search & filter
// ?caseId=&status=&officer=&startDate=&endDate=&search=&page=&limit=
// ---------------------------------------------------------------------------
router.get("/", authenticate, async (req: Request, res: Response) => {
    try {
        const where = await buildEvidenceSearchWhere(req.query as Record<string, unknown>, req.user!);
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));

        const [rows, total] = await Promise.all([
            prisma.evidence.findMany({
                where,
                include: LIST_INCLUDE,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.evidence.count({ where }),
        ]);

        res.json({ page, limit, total, totalPages: Math.ceil(total / limit), items: rows.map(toLedgerView) });
    } catch (err: any) {
        sendError(res, err, "Failed to search evidence");
    }
});

// ---------------------------------------------------------------------------
// GET /api/evidence/:id — ledger record + metadata fetched from IPFS
// ---------------------------------------------------------------------------
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const ev = (await loadEvidence(id))!;
        const assetId = ev.evidenceNumber ?? ev.id;

        let ledgerRecord: ledger.LedgerAsset | null = null;
        let ledgerStatus = "OK";
        try {
            ledgerRecord = await ledger.readAsset(assetId);
            if (!ledgerRecord) ledgerStatus = "NOT_ON_LEDGER";
        } catch (err: any) {
            ledgerStatus = "LEDGER_UNAVAILABLE";
        }

        const cid = ledgerRecord?.cid ?? ev.ipfsCid;
        let metadata: unknown = null;
        let ipfsStatus = "OK";
        if (!cid) {
            ipfsStatus = "NO_CID";
        } else {
            try {
                metadata = JSON.parse((await ipfs.cat(cid)).toString("utf-8"));
            } catch {
                ipfsStatus = "IPFS_FETCH_FAILED";
            }
        }

        await prisma.accessLog.create({
            data: { evidenceId: id, userId: req.user!.id, action: "view", result: "success", ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null },
        });

        res.json({
            ...toLedgerView(ev),
            ledger: ledgerRecord ? { ...ledgerRecord, mode: ledger.getLedgerMode() } : null,
            ledger_status: ledgerStatus,
            ipfs_status: ipfsStatus,
            metadata,
        });
    } catch (err: any) {
        sendError(res, err, "Failed to fetch evidence");
    }
});

// ---------------------------------------------------------------------------
// PUT /api/evidence/:id — Body (any subset): { caseId, description, status, officerName }
// ---------------------------------------------------------------------------
router.put("/:id", authenticate, requirePermission("register_evidence"), async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const { caseId, description, status, officerName, location, notes } = req.body;
        const { anchoring } = await updateEvidence(id, { caseId, description, status, officerName, location }, req.user!, notes);
        res.json({
            success: true,
            cid: anchoring.cid,
            txId: anchoring.txId,
            anchorStatus: anchoring.anchorStatus,
            evidence: toLedgerView((await loadEvidence(id))!),
        });
    } catch (err: any) {
        sendError(res, err, "Failed to update evidence");
    }
});

// ---------------------------------------------------------------------------
// POST /api/evidence/:id/status — Body: { newStatus, officerName?, notes? }
// ---------------------------------------------------------------------------
router.post("/:id/status", authenticate, requirePermission("update_evidence_status"), async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const { newStatus, officerName, notes } = req.body;
        if (!newStatus) { res.status(400).json({ error: "newStatus is required" }); return; }

        const note = [officerName && `By ${officerName}`, notes].filter(Boolean).join(": ") || null;
        const { anchoring } = await updateEvidence(id, { status: newStatus }, req.user!, note);
        const ev = (await loadEvidence(id))!;
        res.json({
            success: true,
            evidenceId: ev.evidenceNumber,
            status: ev.status.toUpperCase(),
            cid: anchoring.cid,
            txId: anchoring.txId,
        });
    } catch (err: any) {
        sendError(res, err, "Failed to update status");
    }
});

// ---------------------------------------------------------------------------
// GET /api/evidence/:id/chain-of-custody
// ---------------------------------------------------------------------------
router.get("/:id/chain-of-custody", authenticate, async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const ev = (await loadEvidence(id))!;
        const events = await prisma.custodyEvent.findMany({
            where: { evidenceId: id },
            orderBy: { timestamp: "asc" },
            include: {
                fromUser: { select: { id: true, username: true, fullName: true } },
                toUser: { select: { id: true, username: true, fullName: true } },
            },
        });
        res.json({
            evidenceId: ev.evidenceNumber ?? ev.id,
            currentCustodian: ev.currentCustodian.fullName,
            locked: ev.locked,
            custodyChain: events.map((e) => ({
                id: e.id,
                timestamp: e.timestamp.toISOString(),
                from: e.fromUser.fullName,
                to: e.toUser.fullName,
                fromUserId: e.fromUserId,
                toUserId: e.toUserId,
                notes: e.reason,
                status: e.status.toUpperCase(),
                signature: e.signature,
            })),
        });
    } catch (err: any) {
        sendError(res, err, "Failed to fetch chain of custody");
    }
});

// ---------------------------------------------------------------------------
// POST /api/evidence/:id/chain-of-custody — Body: { fromOfficer, toOfficer, notes }
// toOfficer may be a user ID, username, email or full name. The entry starts a
// custody transfer that the receiving officer must accept (or reject).
// ---------------------------------------------------------------------------
router.post("/:id/chain-of-custody", authenticate, requirePermission("transfer_evidence"), async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const { toOfficer, toUserId, notes, reason } = req.body;
        const { custodyEvent, recipient, anchoring } = await initiateTransfer(
            id,
            toOfficer ?? toUserId,
            notes ?? reason,
            req.user!
        );
        res.status(201).json({
            success: true,
            message: `Transfer to ${recipient.fullName} recorded and awaiting their acceptance.`,
            entry: {
                id: custodyEvent.id,
                timestamp: custodyEvent.timestamp.toISOString(),
                from: req.user!.username,
                to: recipient.fullName,
                notes: custodyEvent.reason,
                status: "PENDING",
            },
            cid: anchoring.cid,
            txId: anchoring.txId,
        });
    } catch (err: any) {
        sendError(res, err, "Failed to add chain of custody entry");
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/evidence/:id
// ---------------------------------------------------------------------------
router.delete("/:id", authenticate, requirePermission("delete_evidence"), async (req: Request, res: Response) => {
    try {
        const id = await idOr404(req, res);
        if (!id) return;
        const deleted = await deleteEvidence(id);
        await audit(req, { action: "EVIDENCE_DELETED", entityType: "Evidence", entityId: id, details: deleted });
        res.json({ success: true, evidenceId: deleted.evidenceNumber, txId: deleted.ledgerTxId, ...(deleted.ledgerError && { ledgerError: deleted.ledgerError }) });
    } catch (err: any) {
        sendError(res, err, "Failed to delete evidence");
    }
});

export default router;
