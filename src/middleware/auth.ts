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
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { findRole, getJwtSecret, isReadOnlyRole } from "../utils/config.js";

// ---------------------------------------------------------------------------
// Extend Express Request with user info
// ---------------------------------------------------------------------------
export interface AuthenticatedUser {
    id: string;
    username: string;
    role: string;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
            tokenInfo?: { jti: string; exp?: number };
        }
    }
}

// ---------------------------------------------------------------------------
// authenticate — verify JWT token
//
// Also refuses tokens revoked by logout, users that were deactivated, and
// write requests from read-only roles (e.g. auditor).
// ---------------------------------------------------------------------------
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Authentication required. Provide a Bearer token." });
        return;
    }

    const token = authHeader.split(" ")[1];

    let decoded: { userId: string; username: string; role: string; jti?: string; exp?: number };
    try {
        decoded = jwt.verify(token, getJwtSecret()) as typeof decoded;
    } catch (err) {
        res.status(401).json({ error: "Invalid or expired token." });
        return;
    }

    if (!decoded.jti) {
        res.status(401).json({ error: "Session format is outdated. Please log in again." });
        return;
    }

    try {
        const [revoked, user] = await Promise.all([
            prisma.revokedToken.findUnique({ where: { jti: decoded.jti } }),
            prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, username: true, role: true, isActive: true } }),
        ]);

        if (revoked) {
            res.status(401).json({ error: "Token has been revoked. Please log in again." });
            return;
        }
        if (!user || !user.isActive) {
            res.status(401).json({ error: "User account is inactive or no longer exists." });
            return;
        }

        req.user = { id: user.id, username: user.username, role: user.role };
        req.tokenInfo = { jti: decoded.jti, exp: decoded.exp };

        // Logout and joining a Crime Box change nothing, so read-only roles may use them
        const pathOnly = req.originalUrl.split("?")[0];
        const readOnlySafe = pathOnly.endsWith("/auth/logout") || pathOnly.endsWith("/boxes/join");
        if (WRITE_METHODS.has(req.method) && !readOnlySafe && isReadOnlyRole(user.role)) {
            res.status(403).json({
                error: "Your role has read-only access. Write actions are not permitted.",
                your_role: findRole(user.role)?.display_name ?? user.role,
            });
            return;
        }

        next();
    } catch (err: any) {
        res.status(500).json({ error: "Authentication check failed", details: err.message });
    }
}

// ---------------------------------------------------------------------------
// requirePermission — dynamic RBAC from config
//
// Instead of checking role === 'admin', we look up the user's role
// in demo_config.json and check if its permissions array includes
// ALL of the required permissions.
//
// If a permission is removed from the config JSON, access is
// immediately revoked — no code change needed.
// ---------------------------------------------------------------------------
export function requirePermission(...requiredPermissions: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: "Authentication required." });
            return;
        }

        const userRole = req.user.role;
        const roleConfig = findRole(userRole);

        // Role doesn't exist in config (maybe renamed or removed)
        if (!roleConfig) {
            res.status(403).json({
                error: `Role "${userRole}" is not defined in the current system configuration.`,
                hint: "The role may have been renamed or removed. Contact an administrator.",
            });
            return;
        }

        // Check if the role has ALL required permissions
        const rolePermissions = roleConfig.permissions;

        const missingPermissions = requiredPermissions.filter((p) => !rolePermissions.includes(p));

        if (missingPermissions.length > 0) {
            res.status(403).json({
                error: "Insufficient permissions.",
                required: requiredPermissions,
                missing: missingPermissions,
                your_role: roleConfig.display_name,
                your_permissions: rolePermissions,
            });
            return;
        }

        next();
    };
}

// ---------------------------------------------------------------------------
// requireAnyPermission — passes when the role has at least one permission
// ---------------------------------------------------------------------------
export function requireAnyPermission(...permissions: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: "Authentication required." });
            return;
        }

        const roleConfig = findRole(req.user.role);
        if (!roleConfig || !permissions.some((p) => roleConfig.permissions.includes(p))) {
            res.status(403).json({
                error: "Insufficient permissions.",
                required_any_of: permissions,
                your_role: roleConfig?.display_name ?? req.user.role,
            });
            return;
        }

        next();
    };
}

export { prisma };
