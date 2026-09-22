/**
 * Comments routes — per-evidence internal officer notes.
 * Lab Results routes — forensic lab submissions.
 * Access Requests routes — request + approve/deny restricted evidence access.
 * Retention + RBAC per evidence item.
 */
import { Router } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import { getLifecycleConfig, getValidStatuses, isValidStatus } from "../utils/config.js";
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
        if (comment.userId !== req.user.id && !["Admin", "HeadOfficer"].includes(req.user.role)) {
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
        // Notify supervisors
        const supervisors = await prisma.user.findMany({ where: { role: { in: ["Admin", "HeadOfficer"] } } });
        if (supervisors.length > 0) {
            await prisma.notification.createMany({
                data: supervisors.map((s) => ({
                    userId: s.id,
                    type: "access_request",
                    title: "New Access Request",
                    message: `${req.user.username} requested access to evidence`,
                    link: `/dashboard/${s.id}/evidence/${req.params.evidenceId}`,
                })),
            });
        }
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
// DISPOSAL / DESTRUCTION
// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:evidenceId/destruction-requests
router.get("/destruction-requests", authenticate, async (req, res) => {
    try {
        const requests = await prisma.destructionRequest.findMany({
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
        res.status(500).json({ error: "Failed to fetch destruction requests", details: err.message });
    }
});
// POST /api/v1/evidence/:evidenceId/destruction-requests — request destruction
router.post("/destruction-requests", authenticate, async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason?.trim()) {
            res.status(400).json({ error: "reason is required" });
            return;
        }
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.evidenceId },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        // Check if evidence is already destroyed
        if (evidence.status === "Destroyed") {
            res.status(409).json({ error: "Evidence is already destroyed" });
            return;
        }
        // Check for existing pending request
        const existing = await prisma.destructionRequest.findFirst({
            where: { evidenceId: req.params.evidenceId, status: "pending" },
        });
        if (existing) {
            res.status(409).json({ error: "There is already a pending destruction request for this evidence" });
            return;
        }
        const config = getLifecycleConfig();
        const requiresApproval = config.destruction_requires_approval ?? true;
        const request = await prisma.destructionRequest.create({
            data: {
                evidenceId: req.params.evidenceId,
                requesterId: req.user.id,
                reason: reason.trim(),
                status: requiresApproval ? "pending" : "approved",
            },
            include: { requester: { select: { id: true, username: true, fullName: true } } },
        });
        // If no approval required, execute destruction immediately
        if (!requiresApproval) {
            await executeDestruction(req.params.evidenceId, req.user.id, request.id, reason.trim());
        }
        else {
            // Notify supervisors/admins
            const supervisors = await prisma.user.findMany({ where: { role: { in: ["Admin", "HeadOfficer"] } } });
            if (supervisors.length > 0) {
                await prisma.notification.createMany({
                    data: supervisors.map((s) => ({
                        userId: s.id,
                        type: "destruction_request",
                        title: "New Destruction Request",
                        message: `${req.user.username} requested destruction of evidence`,
                        link: `/dashboard/${s.id}/evidence/${req.params.evidenceId}`,
                    })),
                });
            }
        }
        await prisma.activityLog.create({
            data: {
                actorId: req.user.id,
                actorName: req.user.username,
                action: "requested_destruction",
                entityType: "Evidence",
                entityId: req.params.evidenceId,
                entityLabel: evidence.type,
            },
        });
        res.status(201).json(request);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to create destruction request", details: err.message });
    }
});
// PUT /api/v1/evidence/:evidenceId/destruction-requests/:requestId — approve/deny destruction
router.put("/destruction-requests/:requestId", authenticate, async (req, res) => {
    try {
        const { status, reviewNotes } = req.body;
        if (!["approved", "denied"].includes(status)) {
            res.status(400).json({ error: "status must be approved or denied" });
            return;
        }
        const request = await prisma.destructionRequest.findUnique({
            where: { id: req.params.requestId },
            include: { evidence: true },
        });
        if (!request) {
            res.status(404).json({ error: "Destruction request not found" });
            return;
        }
        if (request.status !== "pending") {
            res.status(409).json({ error: "Request already processed" });
            return;
        }
        const updated = await prisma.destructionRequest.update({
            where: { id: req.params.requestId },
            data: { status, reviewNotes: reviewNotes ?? null, reviewerId: req.user.id, reviewedAt: new Date() },
        });
        if (status === "approved") {
            await executeDestruction(request.evidenceId, req.user.id, request.id, request.reason);
        }
        await prisma.notification.create({
            data: {
                userId: request.requesterId,
                type: "destruction_request_reviewed",
                title: `Destruction Request ${status === "approved" ? "Approved" : "Denied"}`,
                message: `Your destruction request was ${status}`,
                link: `/dashboard/${request.requesterId}/evidence/${req.params.evidenceId}`,
            },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to update destruction request", details: err.message });
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
        if (evidence.status === "Destroyed") {
            res.status(409).json({ error: "Cannot archive destroyed evidence" });
            return;
        }
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: { status: "Archived" },
        });
        await prisma.activityLog.create({
            data: {
                actorId: req.user.id,
                actorName: req.user.username,
                action: "archived_evidence",
                entityType: "Evidence",
                entityId: req.params.evidenceId,
                entityLabel: evidence.type,
            },
        });
        await prisma.notification.create({
            data: {
                userId: evidence.currentCustodianId,
                type: "evidence_archived",
                title: "Evidence Archived",
                message: `Evidence ${evidence.type} has been archived`,
                link: `/dashboard/${evidence.currentCustodianId}/evidence/${req.params.evidenceId}`,
            },
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
        // Restore to previous status or default to Collected
        const updated = await prisma.evidence.update({
            where: { id: req.params.evidenceId },
            data: { status: "Collected" },
        });
        await prisma.activityLog.create({
            data: {
                actorId: req.user.id,
                actorName: req.user.username,
                action: "restored_evidence",
                entityType: "Evidence",
                entityId: req.params.evidenceId,
                entityLabel: evidence.type,
            },
        });
        res.json({ success: true, evidence: updated });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to restore evidence", details: err.message });
    }
});
async function executeDestruction(evidenceId, reviewerId, requestId, reason) {
    const config = getLifecycleConfig();
    const generateCertificate = config.certificate_of_destruction ?? true;
    let certificate = "";
    if (generateCertificate) {
        const evidence = await prisma.evidence.findUnique({
            where: { id: evidenceId },
            include: { collectedBy: { select: { fullName: true, badgeNumber: true, department: true } }, files: true },
        });
        if (evidence) {
            certificate = generateDestructionCertificate(evidence, reviewerId, reason);
        }
    }
    await prisma.$transaction([
        prisma.evidence.update({
            where: { id: evidenceId },
            data: { status: "Destroyed" },
        }),
        prisma.destructionRequest.update({
            where: { id: requestId },
            data: { certificate: certificate || null },
        }),
    ]);
    await prisma.activityLog.create({
        data: {
            actorId: reviewerId,
            actorName: (await prisma.user.findUnique({ where: { id: reviewerId }, select: { username: true } }))?.username ?? "Unknown",
            action: "destroyed_evidence",
            entityType: "Evidence",
            entityId: evidenceId,
            entityLabel: "Destroyed",
        },
    });
}
function generateDestructionCertificate(evidence, reviewerId, reason) {
    const now = new Date();
    const reviewer = evidence.collectedBy; // fallback
    return JSON.stringify({
        certificateType: "Certificate of Destruction",
        evidenceId: evidence.id,
        evidenceType: evidence.type,
        caseId: evidence.caseId,
        description: evidence.description,
        collectedBy: evidence.collectedBy?.fullName ?? "Unknown",
        collectedByBadge: evidence.collectedBy?.badgeNumber ?? "N/A",
        department: evidence.collectedBy?.department ?? "N/A",
        destructionDate: now.toISOString(),
        destructionReason: reason,
        destroyedBy: reviewerId,
        fileHashes: evidence.files?.map((f) => f.sha256Hash) ?? [],
        witness: "System Automated",
        certificateHash: `DEST-${evidence.id}-${now.getTime()}`,
    }, null, 2);
}
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
            actionRequired: isExpired && evidence.status !== "Destroyed" && evidence.status !== "Archived",
        });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to check retention status", details: err.message });
    }
});
// GET /api/v1/retention/expiring — list all evidence nearing/exceeding retention (admin only)
router.get("/retention/expiring", authenticate, async (req, res) => {
    try {
        if (!["admin", "head_officer", "auditor"].includes(req.user.role)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
        }
        const { days = "30" } = req.query;
        const thresholdDays = parseInt(days, 10);
        const now = new Date();
        const thresholdDate = new Date(now.getTime() + thresholdDays * 24 * 60 * 60 * 1000);
        const expiring = await prisma.evidence.findMany({
            where: {
                retentionDeadline: { not: null, lte: thresholdDate },
                status: { notIn: ["Destroyed", "Archived"] },
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
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch expiring evidence", details: err.message });
    }
});
// POST /api/v1/retention/notify-expired — send notifications for expired retention (admin/cron)
router.post("/retention/notify-expired", authenticate, async (req, res) => {
    try {
        if (!["admin", "head_officer"].includes(req.user.role)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
        }
        const now = new Date();
        const expired = await prisma.evidence.findMany({
            where: {
                retentionDeadline: { not: null, lt: now },
                status: { notIn: ["Destroyed", "Archived"] },
            },
            select: { id: true, retentionDeadline: true, type: true, currentCustodianId: true, collectedById: true, caseId: true },
        });
        let notified = 0;
        for (const ev of expired) {
            const recipients = new Set();
            if (ev.currentCustodianId)
                recipients.add(ev.currentCustodianId);
            if (ev.collectedById)
                recipients.add(ev.collectedById);
            // Also notify admins
            const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
            admins.forEach((a) => recipients.add(a.id));
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
    }
    catch (err) {
        res.status(500).json({ error: "Failed to send retention expiry notifications", details: err.message });
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
                tags: evidence.tags ? JSON.parse(evidence.tags) : [],
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
                integrityVerified: evidence.fileHash ? "PENDING" : "NO_HASH",
            },
        };
        res.json({ receipt });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to generate collection receipt", details: err.message });
    }
});
// POST /api/v1/evidence/batch — register multiple evidence items
router.post("/batch", authenticate, requirePermission("register_evidence"), async (req, res) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            res.status(400).json({ error: "items array is required" });
            return;
        }
        if (items.length > 50) {
            res.status(400).json({ error: "Maximum 50 items per batch" });
            return;
        }
        const validStatuses = getValidStatuses();
        const validTypes = ["Physical", "Digital", "Testimonial"];
        const results = [];
        for (const item of items) {
            const { caseId, type, description, collectionDate, location, tags, status, officerNotes } = item;
            // Validate required fields
            if (!caseId || !type || !description || !collectionDate || !location) {
                results.push({ success: false, item, error: "Missing required fields" });
                continue;
            }
            if (!validTypes.includes(type)) {
                results.push({ success: false, item, error: `Invalid type "${type}"` });
                continue;
            }
            const evidenceStatus = status ?? validStatuses[0];
            if (!isValidStatus(evidenceStatus)) {
                results.push({ success: false, item, error: `Invalid status "${evidenceStatus}"` });
                continue;
            }
            try {
                const created = await prisma.evidence.create({
                    data: {
                        caseId: caseId.trim(),
                        type,
                        description,
                        collectionDate: new Date(collectionDate),
                        location,
                        tags: tags ? JSON.stringify(tags) : null,
                        status: evidenceStatus,
                        officerNotes: officerNotes ?? null,
                        collectedById: req.user.id,
                        currentCustodianId: req.user.id,
                    },
                });
                await prisma.activityLog.create({
                    data: {
                        actorId: req.user.id,
                        actorName: req.user.username,
                        action: "registered_evidence",
                        entityType: "Evidence",
                        entityId: created.id,
                        entityLabel: created.type,
                    },
                });
                results.push({ success: true, evidence: created });
            }
            catch (err) {
                results.push({ success: false, item, error: err.message });
            }
        }
        const successful = results.filter((r) => r.success).length;
        res.status(successful > 0 ? 201 : 400).json({ results, successful, failed: results.length - successful });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to process batch registration", details: err.message });
    }
});
export default router;
//# sourceMappingURL=evidence-extras.js.map