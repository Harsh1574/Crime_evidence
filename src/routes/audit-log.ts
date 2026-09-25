/**
 * Audit log — security trail of logins, logouts, writes and denials.
 * Restricted to roles with the view_audit_log permission (ADMIN, AUDITOR).
 */
import { Router, Request, Response } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";

const router = Router();

// GET /api/v1/audit-log?userId=&username=&action=&from=&to=&page=&limit=
router.get("/", authenticate, requirePermission("view_audit_log"), async (req: Request, res: Response) => {
  try {
    const { userId, username, action, entityId, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

    const where: any = {};
    if (userId) where.userId = userId as string;
    if (username) where.username = { equals: username as string, mode: "insensitive" };
    if (action) where.action = { contains: action as string, mode: "insensitive" };
    if (entityId) where.entityId = entityId as string;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch audit log", details: err.message });
  }
});

export default router;
