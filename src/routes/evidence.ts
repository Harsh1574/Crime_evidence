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

import { Router, Request, Response } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import { getValidStatuses, readStorageLimitBytes } from "../utils/config.js";
import { computeSHA256, verifyHash } from "../utils/hash.js";
import { sendError } from "../utils/http.js";
import {
    buildEvidenceSearchWhere,
    createEvidence,
    deleteEvidence,
    evidenceVisibilityWhere,
    findEvidenceId,
    getEvidenceDetail,
    readEvidenceFile,
    recordEvidenceChange,
    removeUploadedFiles,
    storeUploadedFiles,
    updateEvidence,
    uploadsDir,
    verifyEvidence,
    UploadedFile,
} from "../services/evidence.js";
import { generateEvidenceReport } from "../services/report.js";
import { audit } from "../services/audit.js";
import { logActivity } from "../services/notifications.js";
import multer from "multer";
import fs from "fs";

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = uploadsDir();
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const safeName = file.originalname.replace(/[^A-Za-z0-9._-]/g, "_");
        cb(null, uniqueSuffix + "-" + safeName);
    },
});

export const upload = multer({ storage, limits: { fileSize: readStorageLimitBytes() } });

const router = Router();

/** Resolve :id (UUID, evidence number or CID) or send 404 */
async function resolveIdOr404(req: Request, res: Response): Promise<string | null> {
    const id = await findEvidenceId(req.params.id as string);
    if (!id) res.status(404).json({ error: "Evidence not found." });
    return id;
}

// ---------------------------------------------------------------------------
// POST /api/v1/evidence — register new evidence (with optional files)
// ---------------------------------------------------------------------------
router.post(
    "/",
    authenticate,
    requirePermission("register_evidence"),
    upload.array("files"), // Handle multiple files
    async (req: Request, res: Response) => {
        const uploaded = (req.files as UploadedFile[] | undefined) ?? [];
        try {
            const stored = await storeUploadedFiles(uploaded);
            const { evidence, anchoring } = await createEvidence(
                {
                    evidenceNumber: req.body.evidenceId ?? req.body.evidenceNumber,
                    caseId: req.body.caseId,
                    type: req.body.type,
                    description: req.body.description,
                    collectionDate: req.body.collectionDate,
                    location: req.body.location,
                    tags: req.body.tags,
                    status: req.body.status,
                    officerNotes: req.body.officerNotes,
                    officerName: req.body.officerName,
                },
                req.user!,
                stored
            );
            res.status(201).json({ success: true, evidence, anchoring });
        } catch (err: any) {
            removeUploadedFiles(uploaded);
            sendError(res, err, "Failed to register evidence");
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/batch — register multiple evidence items (JSON, no files)
// ---------------------------------------------------------------------------
router.post("/batch", authenticate, requirePermission("register_evidence"), async (req: Request, res: Response) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            res.status(400).json({ error: "items array is required" }); return;
        }
        if (items.length > 50) { res.status(400).json({ error: "Maximum 50 items per batch" }); return; }

        const results = [];
        for (const item of items) {
            try {
                const { evidence, anchoring } = await createEvidence(
                    { ...item, evidenceNumber: item.evidenceId ?? item.evidenceNumber },
                    req.user!
                );
                results.push({ success: true, evidence, anchoring });
            } catch (err: any) {
                results.push({ success: false, item, error: err.message });
            }
        }

        const successful = results.filter((r) => r.success).length;
        res.status(successful > 0 ? 201 : 400).json({ results, successful, failed: results.length - successful });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to process batch registration", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/evidence/bulk — delete several evidence items
// ---------------------------------------------------------------------------
router.delete("/bulk", authenticate, requirePermission("delete_evidence"), async (req: Request, res: Response) => {
    try {
        const ids: unknown = req.body?.evidenceIds;
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
                results.push({ ...deleted, requested: ref, success: true });
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
// GET /api/v1/evidence — search/filter evidence
// ---------------------------------------------------------------------------
router.get("/", authenticate, async (req: Request, res: Response) => {
    try {
        const { page = "1", limit = "20" } = req.query;
        const where = await buildEvidenceSearchWhere(req.query as Record<string, unknown>, req.user!);

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
        const skip = (pageNum - 1) * pageSize;

        const [evidence, total] = await Promise.all([
            prisma.evidence.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: "desc" },
                include: {
                    collectedBy: {
                        select: { id: true, username: true, fullName: true },
                    },
                    currentCustodian: {
                        select: { id: true, username: true, fullName: true },
                    },
                    _count: { select: { files: true, custodyEvents: true } },
                },
            }),
            prisma.evidence.count({ where }),
        ]);

        res.json({
            evidence,
            pagination: {
                page: pageNum,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (err: any) {
        sendError(res, err, "Failed to search evidence");
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/retention/expiring — evidence nearing/exceeding retention
// ---------------------------------------------------------------------------
router.get("/retention/expiring", authenticate, async (req: Request, res: Response) => {
    try {
        if (!["admin", "head_officer", "auditor"].includes(req.user!.role)) {
            res.status(403).json({ error: "Insufficient permissions" }); return;
        }

        const { days = "30" } = req.query;
        const thresholdDays = parseInt(days as string, 10);
        const now = new Date();
        const thresholdDate = new Date(now.getTime() + thresholdDays * 24 * 60 * 60 * 1000);

        const expiring = await prisma.evidence.findMany({
            where: {
                retentionDeadline: { not: null, lte: thresholdDate },
                status: { notIn: ["Destroyed", "Disposed", "Archived"] },
            },
            include: {
                collectedBy: { select: { id: true, username: true, fullName: true, role: true } },
                currentCustodian: { select: { id: true, username: true, fullName: true, role: true } },
            },
            orderBy: { retentionDeadline: "asc" },
        });

        res.json({
            count: expiring.length,
            thresholdDays,
            evidence: expiring.map((e) => ({
                ...e,
                daysUntilExpiry: e.retentionDeadline ? Math.ceil((new Date(e.retentionDeadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
                isExpired: e.retentionDeadline ? new Date(e.retentionDeadline) < now : false,
            })),
        });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to fetch expiring evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/retention/notify-expired — notify about expired retention
// ---------------------------------------------------------------------------
router.post("/retention/notify-expired", authenticate, async (req: Request, res: Response) => {
    try {
        if (!["admin", "head_officer"].includes(req.user!.role)) {
            res.status(403).json({ error: "Insufficient permissions" }); return;
        }

        const now = new Date();
        const expired = await prisma.evidence.findMany({
            where: {
                retentionDeadline: { not: null, lt: now },
                status: { notIn: ["Destroyed", "Disposed", "Archived"] },
            },
            select: { id: true, retentionDeadline: true, type: true, currentCustodianId: true, collectedById: true, caseId: true },
        });
        const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });

        let notified = 0;
        for (const ev of expired) {
            const recipients = new Set<string>([ev.currentCustodianId, ev.collectedById, ...admins.map((a) => a.id)]);
            for (const userId of recipients) {
                await prisma.notification.create({
                    data: {
                        userId,
                        type: "retention_expiry",
                        title: "Retention Period Expired",
                        message: `Evidence ${ev.type} (Case: ${ev.caseId}) has exceeded its retention period. Action required.`,
                        link: `/dashboard/${userId}/evidence/${ev.id}`,
                    },
                });
                notified++;
            }
        }

        res.json({ success: true, expiredCount: expired.length, notificationsSent: notified });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to send retention expiry notifications", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id — get evidence detail (UUID, evidence number or CID)
// ---------------------------------------------------------------------------
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;

        const evidence = await getEvidenceDetail(id);
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found." });
            return;
        }

        // Log access
        await prisma.accessLog.create({
            data: {
                evidenceId: evidence.id,
                userId: req.user!.id,
                action: "view",
                result: "success",
                ipAddress: req.ip ?? null,
                userAgent: req.headers["user-agent"] ?? null,
            },
        });

        res.json({ evidence });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to fetch evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/evidence/:id — update evidence metadata
// ---------------------------------------------------------------------------
router.put(
    "/:id",
    authenticate,
    requirePermission("register_evidence"),
    async (req: Request, res: Response) => {
        try {
            const id = await resolveIdOr404(req, res);
            if (!id) return;

            const { description, tags, status, officerNotes, location, caseId, officerName, notes } = req.body;
            const { evidence, anchoring } = await updateEvidence(
                id,
                { description, tags, status, officerNotes, location, caseId, officerName },
                req.user!,
                notes
            );

            res.json({ success: true, evidence, anchoring });
        } catch (err: any) {
            sendError(res, err, "Failed to update evidence");
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/status — move evidence to a new lifecycle status
// Body: { newStatus | status, notes? }
// ---------------------------------------------------------------------------
router.post(
    "/:id/status",
    authenticate,
    requirePermission("update_evidence_status"),
    async (req: Request, res: Response) => {
        try {
            const id = await resolveIdOr404(req, res);
            if (!id) return;

            const newStatus = req.body.newStatus ?? req.body.status;
            if (!newStatus) {
                res.status(400).json({ error: "newStatus is required", valid_statuses: getValidStatuses() });
                return;
            }
            const { evidence, anchoring } = await updateEvidence(id, { status: newStatus }, req.user!, req.body.notes);
            res.json({ success: true, evidence, anchoring });
        } catch (err: any) {
            sendError(res, err, "Failed to update evidence status");
        }
    }
);

// ---------------------------------------------------------------------------
// DELETE /api/v1/evidence/:id — delete evidence (ledger history is kept)
// ---------------------------------------------------------------------------
router.delete("/:id", authenticate, requirePermission("delete_evidence"), async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;

        const deleted = await deleteEvidence(id);
        await audit(req, { action: "EVIDENCE_DELETED", entityType: "Evidence", entityId: id, details: deleted });
        res.json({ success: true, ...deleted });
    } catch (err: any) {
        sendError(res, err, "Failed to delete evidence");
    }
});

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/verify — verify integrity
//
// With no body: re-hashes stored files, rebuilds the metadata hash and checks
// both against IPFS and the ledger → status VERIFIED / TAMPERED / UNVERIFIABLE.
// With { fileContent } (base64): additionally checks that file against the
// recorded file hash.
// ---------------------------------------------------------------------------
router.post("/:id/verify", authenticate, async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;

        const result = await verifyEvidence(id);

        let providedFile;
        const { fileContent } = req.body ?? {};
        if (fileContent && result.fileHash) {
            const buffer = Buffer.from(fileContent, "base64");
            const matches = verifyHash(buffer, result.fileHash);
            providedFile = {
                status: matches ? "PASS" : "FAIL",
                expectedHash: result.fileHash,
                actualHash: computeSHA256(buffer),
                verified: matches,
            };
        }

        await logActivity(req.user!, "verified_integrity", "Evidence", id, result.status);
        await audit(req, { action: "INTEGRITY_VERIFIED", entityType: "Evidence", entityId: id, details: { status: result.status } });

        const evidence = await prisma.evidence.findUnique({ where: { id }, include: { files: true } });
        res.json({
            evidenceId: id,
            caseId: evidence?.caseId,
            integrity: { ...result, ...(providedFile && { providedFile }) },
            files: (evidence?.files ?? []).map((f) => ({
                id: f.id,
                fileName: f.fileName,
                sha256Hash: f.sha256Hash,
                ipfsCid: f.ipfsCid,
            })),
        });
    } catch (err: any) {
        sendError(res, err, "Failed to verify integrity");
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id/versions — full version history (who / when / what)
// ---------------------------------------------------------------------------
router.get("/:id/versions", authenticate, async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;

        const versions = await prisma.evidenceVersion.findMany({
            where: { evidenceId: id },
            orderBy: { version: "asc" },
            include: { changedBy: { select: { id: true, username: true, fullName: true, role: true } } },
        });
        res.json({ evidenceId: id, total: versions.length, versions });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to fetch version history", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/anchor — retry anchoring after an IPFS/ledger outage
// ---------------------------------------------------------------------------
router.post("/:id/anchor", authenticate, requirePermission("register_evidence"), async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;
        const anchoring = await recordEvidenceChange(id, { action: "REANCHORED", actor: req.user! });
        res.json({ success: anchoring.anchorStatus === "ANCHORED", anchoring });
    } catch (err: any) {
        sendError(res, err, "Failed to anchor evidence");
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id/report — evidence report as PDF
// ---------------------------------------------------------------------------
router.get("/:id/report", authenticate, requirePermission("generate_reports"), async (req: Request, res: Response) => {
    try {
        const id = await resolveIdOr404(req, res);
        if (!id) return;

        const { buffer, fileName } = await generateEvidenceReport(id, req.user!);
        await logActivity(req.user!, "generated_report", "Evidence", id, fileName);
        await audit(req, { action: "REPORT_GENERATED", entityType: "Evidence", entityId: id, statusCode: 200 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.send(buffer);
    } catch (err: any) {
        sendError(res, err, "Failed to generate report");
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id/download — download the primary evidence file
// GET /api/v1/evidence/:id/files/:fileId/download — download a specific file
// ---------------------------------------------------------------------------
async function sendEvidenceFile(req: Request, res: Response, fileId?: string) {
    const id = await resolveIdOr404(req, res);
    if (!id) return;

    const fileRecord = fileId
        ? await prisma.evidenceFile.findFirst({ where: { id: fileId, evidenceId: id } })
        : await prisma.evidenceFile.findFirst({ where: { evidenceId: id }, orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] });

    if (!fileRecord) {
        res.status(404).json({ error: "File record not found" });
        return;
    }

    let content: Buffer;
    try {
        content = await readEvidenceFile(fileRecord);
    } catch (err: any) {
        res.status(404).json({ error: "File content not found", details: err.message });
        return;
    }

    const actualHash = computeSHA256(content);
    await prisma.accessLog.create({
        data: { evidenceId: id, userId: req.user!.id, action: "download", result: "success", ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null },
    });
    await audit(req, { action: "FILE_DOWNLOADED", entityType: "EvidenceFile", entityId: fileRecord.id, statusCode: 200 });

    res.setHeader("Content-Type", fileRecord.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`);
    res.setHeader("X-File-SHA256", actualHash);
    res.setHeader("X-File-Integrity", actualHash === fileRecord.sha256Hash ? "VERIFIED" : "TAMPERED");
    res.send(content);
}

router.get("/:id/download", authenticate, async (req: Request, res: Response) => {
    try {
        await sendEvidenceFile(req, res);
    } catch (err: any) {
        res.status(500).json({ error: "Failed to download file", details: err.message });
    }
});

router.get("/:id/files/:fileId/download", authenticate, async (req: Request, res: Response) => {
    try {
        await sendEvidenceFile(req, res, req.params.fileId as string);
    } catch (err: any) {
        res.status(500).json({ error: "Failed to download file", details: err.message });
    }
});

export default router;
