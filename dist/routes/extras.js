/**
 * Notifications, Activity Feed, Public Verify, QR Code routes.
 */
import { Router } from "express";
import { authenticate, prisma } from "../middleware/auth.js";
import QRCode from "qrcode";
import { verifyEvidence } from "../services/evidence.js";
import { getRoles } from "../utils/config.js";
const router = Router();
// ---------------------------------------------------------------------------
// GET /api/v1/notifications
// ---------------------------------------------------------------------------
router.get("/notifications", authenticate, async (req, res) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        const unreadCount = notifications.filter((n) => !n.read).length;
        res.json({ notifications, unreadCount });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch notifications", details: err.message });
    }
});
router.put("/notifications/read-all", authenticate, async (req, res) => {
    try {
        await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to mark all read", details: err.message });
    }
});
router.put("/notifications/:id/read", authenticate, async (req, res) => {
    try {
        await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to mark notification read", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// GET /api/v1/users?search=&role= — active users for pickers (transfer, case officers)
// ---------------------------------------------------------------------------
router.get("/users", authenticate, async (req, res) => {
    try {
        const search = req.query.search?.trim();
        const role = req.query.role?.trim();
        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                ...(role && { role: { equals: role, mode: "insensitive" } }),
                ...(search && {
                    OR: [
                        { username: { contains: search, mode: "insensitive" } },
                        { fullName: { contains: search, mode: "insensitive" } },
                        { email: { contains: search, mode: "insensitive" } },
                    ],
                }),
            },
            select: { id: true, username: true, fullName: true, role: true, department: true, badgeNumber: true },
            orderBy: { fullName: "asc" },
            take: 50,
        });
        res.json({ users });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch users", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// GET /api/v1/roles — role names, display names and permissions
// ---------------------------------------------------------------------------
router.get("/roles", async (_req, res) => {
    try {
        res.json({ roles: getRoles().map((r) => ({ name: r.name, displayName: r.display_name, readOnly: r.read_only === true })) });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch roles", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// GET /api/v1/activity
// ---------------------------------------------------------------------------
router.get("/activity", authenticate, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        // ?mine=true → only the current user's own actions
        const where = req.query.mine === "true" ? { actorId: req.user.id } : {};
        const [logs, total] = await Promise.all([
            prisma.activityLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: { actor: { select: { id: true, username: true, fullName: true, role: true } } },
            }),
            prisma.activityLog.count({ where }),
        ]);
        res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch activity", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// GET /api/v1/verify/:hash — PUBLIC (no auth)
// ---------------------------------------------------------------------------
router.get("/verify/:hash", async (req, res) => {
    try {
        const hash = req.params.hash;
        const evidence = await prisma.evidence.findFirst({
            where: {
                OR: [
                    { fileHash: { equals: hash } },
                    { metadataHash: { equals: hash } },
                    { evidenceNumber: { equals: hash } },
                    { files: { some: { sha256Hash: { equals: hash } } } },
                ],
            },
            select: {
                id: true,
                evidenceNumber: true,
                caseId: true,
                type: true,
                description: true,
                collectionDate: true,
                location: true,
                status: true,
                createdAt: true,
                metadataHash: true,
                ipfsCid: true,
                ledgerTxId: true,
                anchorStatus: true,
                collectedBy: { select: { fullName: true, badgeNumber: true, department: true } },
                files: { select: { fileName: true, sha256Hash: true, uploadedAt: true, fileSize: true } },
            },
        });
        if (!evidence) {
            res.status(404).json({ verified: false, message: "No evidence found matching this hash." });
            return;
        }
        // A hash match only proves the hash is known; run the full integrity check too
        const integrity = await verifyEvidence(evidence.id);
        res.json({
            verified: integrity.status === "VERIFIED",
            integrityStatus: integrity.status,
            evidence,
            checks: integrity.checks.map((c) => ({ name: c.name, passed: c.passed })),
        });
    }
    catch (err) {
        res.status(500).json({ error: "Verification failed", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id/qr
// ---------------------------------------------------------------------------
router.get("/evidence/:id/qr", authenticate, async (req, res) => {
    try {
        const evidenceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const evidence = await prisma.evidence.findUnique({
            where: { id: evidenceId },
            include: { files: { select: { sha256Hash: true }, take: 1 } },
        });
        if (!evidence) {
            res.status(404).json({ error: "Evidence not found" });
            return;
        }
        const hash = evidence.fileHash || evidence.files[0]?.sha256Hash || evidence.id;
        const baseUrl = process.env.APP_PUBLIC_URL || "http://localhost:3000";
        const verifyUrl = `${baseUrl}/verify/${hash}`;
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
            width: 300,
            margin: 2,
            color: { dark: "#22c55e", light: "#0c0f14" },
        });
        res.json({ qrDataUrl, verifyUrl, hash });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to generate QR code", details: err.message });
    }
});
export default router;
//# sourceMappingURL=extras.js.map