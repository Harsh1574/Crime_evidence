/**
 * Security audit trail.
 *
 * - audit(): write one AuditLog row (never throws — auditing must not break a request)
 * - auditTrail: Express middleware that records every write request and every
 *   401/403 denial once the response has been sent.
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

export interface AuditEntry {
    action: string;
    userId?: string | null;
    username?: string | null;
    role?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    statusCode?: number | null;
    details?: Record<string, unknown> | null;
}

export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                action: entry.action,
                userId: entry.userId ?? req?.user?.id ?? null,
                username: entry.username ?? req?.user?.username ?? null,
                role: entry.role ?? req?.user?.role ?? null,
                method: req?.method ?? null,
                path: req ? req.originalUrl.split("?")[0] : null,
                statusCode: entry.statusCode ?? null,
                entityType: entry.entityType ?? null,
                entityId: entry.entityId ?? null,
                ipAddress: req?.ip ?? null,
                userAgent: (req?.headers["user-agent"] as string | undefined) ?? null,
                details: (entry.details as any) ?? undefined,
            },
        });
    } catch (err: any) {
        console.error("[audit] Failed to write audit log:", err.message);
    }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Logged explicitly by the auth routes with richer detail
const EXPLICITLY_AUDITED = [/\/auth\/login$/, /\/auth\/logout$/];

export function auditTrail(req: Request, res: Response, next: NextFunction): void {
    res.on("finish", () => {
        const pathOnly = req.originalUrl.split("?")[0];
        if (!pathOnly.startsWith("/api")) return;
        if (EXPLICITLY_AUDITED.some((re) => re.test(pathOnly))) return;

        const denied = res.statusCode === 401 || res.statusCode === 403;
        if (!WRITE_METHODS.has(req.method) && !denied) return;

        const action = denied
            ? (res.statusCode === 401 ? "ACCESS_UNAUTHENTICATED" : "ACCESS_DENIED")
            : `${req.method} ${pathOnly}`;

        void audit(req, { action, statusCode: res.statusCode });
    });
    next();
}
