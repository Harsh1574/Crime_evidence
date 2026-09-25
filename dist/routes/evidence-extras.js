/**
 * Comments routes — per-evidence internal officer notes.
 * Lab Results routes — forensic lab submissions.
 * Access Requests routes — request + approve/deny restricted evidence access.
 * Retention + RBAC per evidence item.
 * Disposal requests, archive/restore, collection receipt.
 */
import { Router } from "express";
import { authenticate, prisma } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import { recordEvidenceChange, TERMINAL_STATUSES } from "../services/evidence.js";
import { DISPOSAL_INCLUDE, requestDisposal, reviewDisposal } from "../services/disposal.js";
import { logActivity, notifyPermissionHolders, notifyUsers } from "../services/notifications.js";
const router = Router({ mergeParams: true });
// ---------------------------------------------------------------------------
// COMMENTS
// ---------------------------------------------------------------------------
router.get("/comments", authenticate, async (req, res) => {
    try {
        const comments = await prisma.evidenceComment.findMany({
            where: { evidenceId: req.params.evidenceId },
            include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
            orderBy: { createdAt: "asc" },
        });
        res.json(comments);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch comments", details: err.message });
    }
});
router.post("/comments", authenticate, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) {
            res.status(400).json({ error: "content is required" });
            return;
        }
        const comment = await prisma.evidenceComment.create({
            data: { evidenceId: req.params.evidenceId, userId: req.user.id, content: content.trim() },
            include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
        });
        await prisma.activityLog.create({
            data: {
                actorId: req.user.id,
                actorName: req.user.username,
                action: "commented",
                entityType: "Evidence",
                entityId: req.params.evidenceId,
            },
        });
        res.status(201).json(comment);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to create comment", details: err.message });
    }
});
router.delete("/comments/:commentId", authenticate, async (req, res) => {
    try {
        const comment = await prisma.evidenceComment.findUnique({ where: { id: req.params.commentId } });
        if (!comment) {
            res.status(404).json({ error: "Comment not found" });
            return;
        }
        if (comment.userId !== req.user.id && !["admin", "head_officer"].includes(req.user.role)) {
            res.status(403).json({ error: "Not authorised to delete this comment" });
            return;
        }
        await prisma.evidenceComment.delete({ where: { id: req.params.commentId } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to delete comment", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// LAB RESULTS
// ---------------------------------------------------------------------------
router.get("/lab-results", authenticate, async (req, res) => {
    try {
        const results = await prisma.labResult.findMany({
            where: { evidenceId: req.params.evidenceId },
            include: { submittedBy: { select: { id: true, username: true, fullName: true } } },
            orderBy: { submittedAt: "desc" },
        });
        res.json(results);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch lab results", details: err.message });
    }
});
router.post("/lab-results", authenticate, async (req, res) => {
    try {
        const { title, summary, findings } = req.body;
        if (!title || !summary) {
            res.status(400).json({ error: "title and summary are required" });
            return;
        }
        const result = await prisma.labResult.create({
            data: {
                evidenceId: req.params.evidenceId,
                submittedById: req.user.id,
                title,
                summary,
                findings: findings ?? null,
            },
            include: { submittedBy: { select: { id: true, username: true, fullName: true } } },
        });
        await prisma.activityLog.create({
            data: {
                actorId: req.user.id,
                actorName: req.user.username,
                action: "submitted_lab_result",
                entityType: "Evidence",
                entityId: req.params.evidenceId,
                entityLabel: title,
            },
        });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to submit lab result", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// ACCESS REQUESTS
// ---------------------------------------------------------------------------
router.get("/requests", authenticate, async (req, res) => {
    try {
        const requests = await prisma.evidenceAccessRequest.findMany({
            where: { evidenceId: req.params.evidenceId },
            include: {
                requester: { select: { id: true, username: true, fullName: true, role: true } },
                reviewer: { select: { id: true, username: true, fullName: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(requests);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch requests", details: err.message });
    }
});
router.post("/requests", authenticate, async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason?.trim()) {
            res.status(400).json({ error: "reason is required" });
            return;
        }
        const existing = await prisma.evidenceAccessRequest.findFirst({
            where: { evidenceId: req.params.evidenceId, requesterId: req.user.id, status: "pending" },
        });
        if (existing) {
            res.status(409).json({ error: "You already have a pending request for this evidence" });
            return;
        }
        const request = await prisma.evidenceAccessRequest.create({
            data: { evidenceId: req.params.evidenceId, requesterId: req.user.id, reason: reason.trim() },
            include: { requester: { select: { id: true, username: true, fullName: true } } },
        });
        // Notify supervisors (roles that can approve access, plus administrators)
        const notice = {
            type: "access_request",
            title: "New Access Request",
            message: `${req.user.username} requested access to evidence`,
            evidenceId: req.params.evidenceId,
        };
        await notifyPermissionHolders("approve_access", notice, req.user.id);
        await notifyPermissionHolders("user_management", notice, req.user.id);
        res.status(201).json(request);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to create request", details: err.message });
    }
});
router.put("/requests/:requestId", authenticate, async (req, res) => {
    try {
        const { status, reviewNotes } = req.body;
        if (!["approved", "denied"].includes(status)) {
            res.status(400).json({ error: "status must be approved or denied" });
            return;
        }
        const updated = await prisma.evidenceAccessRequest.update({
            where: { id: req.params.requestId },
            data: { status, reviewNotes: reviewNotes ?? null, reviewerId: req.user.id, reviewedAt: new Date() },
        });
        await prisma.notification.create({
            data: {
                userId: updated.requesterId,
                type: "access_request_reviewed",
                title: `Access Request ${status === "approved" ? "Approved" : "Denied"}`,
                message: `Your access request was ${status}`,
                link: `/dashboard/${updated.requesterId}/evidence/${req.params.evidenceId}`,
            },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to update request", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// RETENTION
// ---------------------------------------------------------------------------
router.put("/retention", authenticate, async (req, res) => {
    try {
        const { retentionDeadline, retentionPolicy } = req.body;
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: {
                retentionDeadline: retentionDeadline ? new Date(retentionDeadline) : null,
                retentionPolicy: retentionPolicy ?? null,
            },
        });
        res.json({ success: true, evidence: updated });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to update retention", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------
router.get("/rbac", authenticate, async (req, res) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
            select: { allowedRoles: true },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        res.json({ allowedRoles: evidence.allowedRoles ? JSON.parse(evidence.allowedRoles) : null });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch RBAC", details: err.message });
    }
});
router.put("/rbac", authenticate, async (req, res) => {
    try {
        const { allowedRoles } = req.body;
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: { allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : null },
        });
        res.json({ success: true, allowedRoles: updated.allowedRoles ? JSON.parse(updated.allowedRoles) : null });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to update RBAC", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// DISPOSAL (a.k.a. destruction) — request by PROSECUTOR, decision by JUDGE
// Both /destruction-requests and /disposal-requests paths are served.
// ---------------------------------------------------------------------------
const DISPOSAL_PATHS = ["/destruction-requests", "/disposal-requests"];
// GET /api/v1/evidence/:evidenceId/disposal-requests
router.get(DISPOSAL_PATHS, authenticate, async (req, res) => {
    try {
        const requests = await prisma.destructionRequest.findMany({
            where: { evidenceId: req.params.evidenceId },
            include: DISPOSAL_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
        res.json(requests);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch disposal requests", details: err.message });
    }
});
// POST /api/v1/evidence/:evidenceId/disposal-requests — request disposal
router.post(DISPOSAL_PATHS, authenticate, async (req, res) => {
    try {
        const request = await requestDisposal(req.params.evidenceId, req.body.reason, req.user);
        res.status(201).json(request);
    }
    catch (err) {
        sendError(res, err, "Failed to create disposal request");
    }
});
// PUT /api/v1/evidence/:evidenceId/disposal-requests/:requestId — approve/reject (JUDGE only)
router.put(DISPOSAL_PATHS.map((p) => `${p}/:requestId`), authenticate, async (req, res) => {
    try {
        const existing = await prisma.destructionRequest.findFirst({
            where: { id: req.params.requestId, evidenceId: req.params.evidenceId },
            select: { id: true },
        });
        if (!existing) {
            res.status(404).json({ error: "Disposal request not found" });
            return;
        }
        const updated = await reviewDisposal(existing.id, req.body.status, req.body.reviewNotes ?? req.body.note, req.user);
        res.json(updated);
    }
    catch (err) {
        sendError(res, err, "Failed to update disposal request");
    }
});
// POST /api/v1/evidence/:evidenceId/archive — archive evidence
router.post("/archive", authenticate, async (req, res) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        if (evidence.status === "Archived") {
            res.status(409).json({ error: "Evidence is already archived" });
            return;
        }
        if (TERMINAL_STATUSES.includes(evidence.status)) {
            res.status(409).json({ error: `Cannot archive ${evidence.status.toLowerCase()} evidence` });
            return;
        }
        if (evidence.locked) {
            res.status(409).json({ error: "Evidence is locked due to a pending custody transfer." });
            return;
        }
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: { status: "Archived" },
        });
        await logActivity(req.user, "archived_evidence", "Evidence", evidence.id, evidence.type);
        await recordEvidenceChange(evidence.id, { action: "STATUS_CHANGED:ARCHIVED", actor: req.user });
        await notifyUsers([evidence.currentCustodianId], {
            type: "evidence_archived",
            title: "Evidence Archived",
            message: `Evidence ${evidence.evidenceNumber ?? evidence.type} has been archived`,
            evidenceId: evidence.id,
        });
        res.json({ success: true, evidence: updated });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to archive evidence", details: err.message });
    }
});
// POST /api/v1/evidence/:evidenceId/restore — restore from archive
router.post("/restore", authenticate, async (req, res) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        if (evidence.status !== "Archived") {
            res.status(409).json({ error: "Evidence is not archived" });
            return;
        }
        // Restore to Collected
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: { status: "Collected" },
        });
        await logActivity(req.user, "restored_evidence", "Evidence", evidence.id, evidence.type);
        await recordEvidenceChange(evidence.id, { action: "STATUS_CHANGED:COLLECTED", actor: req.user });
        res.json({ success: true, evidence: updated });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to restore evidence", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// RETENTION EXPIRY
// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:evidenceId/retention-status — check retention status
router.get("/retention-status", authenticate, async (req, res) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
            select: { id: true, retentionDeadline: true, retentionPolicy: true, status: true, collectedById: true, currentCustodianId: true },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        const now = new Date();
        const deadline = evidence.retentionDeadline ? new Date(evidence.retentionDeadline) : null;
        const isExpired = deadline && deadline < now;
        const daysUntilExpiry = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
        res.json({
            evidenceId: evidence.id,
            retentionDeadline: evidence.retentionDeadline,
            retentionPolicy: evidence.retentionPolicy,
            status: evidence.status,
            isExpired,
            daysUntilExpiry,
            actionRequired: isExpired && !TERMINAL_STATUSES.includes(evidence.status) && evidence.status !== "Archived",
        });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to check retention status", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// COLLECTION WORKFLOW
// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:evidenceId/collection-receipt — generate collection receipt
router.get("/collection-receipt", authenticate, async (req, res) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
            include: {
                collectedBy: { select: { id: true, username: true, fullName: true, badgeNumber: true, department: true } },
                currentCustodian: { select: { id: true, username: true, fullName: true, badgeNumber: true, department: true } },
                caseRef: { select: { id: true, title: true, description: true } },
                files: { select: { id: true, fileName: true, fileSize: true, mimeType: true, sha256Hash: true, uploadedAt: true } },
                custodyEvents: {
                    orderBy: { timestamp: "asc" },
                    include: {
                        fromUser: { select: { username: true, fullName: true, badgeNumber: true } },
                        toUser: { select: { username: true, fullName: true, badgeNumber: true } },
                    },
                },
            },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        const receipt = {
            receiptNumber: `COL-${evidence.id.slice(0, 8).toUpperCase()}`,
            issuedAt: new Date().toISOString(),
            evidence: {
                id: evidence.id,
                type: evidence.type,
                description: evidence.description,
                collectionDate: evidence.collectionDate,
                location: evidence.location,
                tags: parseTags(evidence.tags),
                status: evidence.status,
                fileHash: evidence.fileHash,
                ipfsCid: evidence.ipfsCid,
            },
            case: evidence.caseRef ? { id: evidence.caseRef.id, title: evidence.caseRef.title } : { id: evidence.caseId },
            collectedBy: evidence.collectedBy,
            currentCustodian: evidence.currentCustodian,
            files: evidence.files,
            chainOfCustody: evidence.custodyEvents.map((event) => ({
                eventType: event.eventType,
                reason: event.reason,
                status: event.status,
                timestamp: event.timestamp,
                from: event.fromUser,
                to: event.toUser,
                signature: event.signature,
            })),
            verification: {
                hashAlgorithm: "SHA-256",
                metadataHash: evidence.metadataHash,
                ledgerTxId: evidence.ledgerTxId,
                anchorStatus: evidence.anchorStatus,
                integrityVerified: evidence.fileHash ? "PENDING" : "NO_HASH",
            },
        };
        res.json({ receipt });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to generate collection receipt", details: err.message });
    }
});
/** Tags are stored as a JSON array string, but older rows may hold plain text */
function parseTags(tags) {
    if (!tags)
        return [];
    try {
        return JSON.parse(tags);
    }
    catch {
        return tags.split(",").map((t) => t.trim()).filter(Boolean);
    }
}
export default router;
//# sourceMappingURL=evidence-extras.js.map