/**
 * Audit log — security trail of logins, logouts, writes and denials.
 * Restricted to roles with the view_audit_log permission (ADMIN, AUDITOR).
 */
import { Router } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
const router = Router();
// GET /api/v1/audit-log?userId=&username=&action=&from=&to=&page=&limit=
router.get("/", authenticate, requirePermission("view_audit_log"), async (req, res) => {
    try {
        const { userId, username, action, entityId, from, to } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const where = {};
        if (userId)
            where.userId = userId;
        if (username)
            where.username = { equals: username, mode: "insensitive" };
        if (action)
            where.action = { contains: action, mode: "insensitive" };
        if (entityId)
            where.entityId = entityId;
        if (from || to) {
            where.createdAt = {};
            if (from)
                where.createdAt.gte = new Date(from);
            if (to)
                where.createdAt.lte = new Date(to);
        }
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
            prisma.auditLog.count({ where }),
        ]);
        res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch audit log", details: err.message });
    }
});
export default router;
//# sourceMappingURL=audit-log.js.map