/**
 * Security audit trail.
 *
 * - audit(): write one AuditLog row (never throws — auditing must not break a request)
 * - auditTrail: Express middleware that records every write request and every
 *   401/403 denial once the response has been sent.
 */
import { Request, Response, NextFunction } from "express";
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
export declare function audit(req: Request | null, entry: AuditEntry): Promise<void>;
export declare function auditTrail(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=audit.d.ts.map