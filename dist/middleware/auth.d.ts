/**
 * Authentication & Dynamic RBAC middleware.
 *
 * - authenticate: verifies JWT (and that it was not revoked), attaches req.user
 * - requirePermission: looks up permissions from demo_config.json at runtime
 * - requireAnyPermission: passes when the role has at least one of the permissions
 *
 * Permissions are NOT hardcoded — if you remove a permission from
 * a role in the config, it takes effect immediately.
 */
import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
export interface AuthenticatedUser {
    id: string;
    username: string;
    role: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
            tokenInfo?: {
                jti: string;
                exp?: number;
            };
        }
    }
}
export declare function authenticate(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function requirePermission(...requiredPermissions: string[]): (req: Request, res: Response, next: NextFunction) => void;
export declare function requireAnyPermission(...permissions: string[]): (req: Request, res: Response, next: NextFunction) => void;
export { prisma };
//# sourceMappingURL=auth.d.ts.map