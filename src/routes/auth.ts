/**
 * Authentication routes — register, login, logout, profile.
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { authenticate, prisma } from "../middleware/auth.js";
import {
    getValidRoleNames,
    getJwtSecret,
    getSessionTimeout,
    normalizeRoleName,
} from "../utils/config.js";
import { audit } from "../services/audit.js";
import { seedDemoUsers } from "../services/seed.js";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register — create a new user (Public for demo)
// ---------------------------------------------------------------------------
router.post(
    "/register",
    // authenticate, // Disabled for public registration
    // requirePermission("user_management"),
    async (req: Request, res: Response) => {
        try {
            const { username, email, fullName, badgeNumber, department, role, password } = req.body;

            // Validate required fields
            if (!username || !email || !fullName || !role || !password) {
                res.status(400).json({
                    error: "Missing required fields",
                    required: ["username", "email", "fullName", "role", "password"],
                });
                return;
            }

            // Validate role against config (zero-hardcoding, case-insensitive)
            const canonicalRole = normalizeRoleName(role);
            if (!canonicalRole) {
                res.status(400).json({
                    error: `Invalid role "${role}"`,
                    valid_roles: getValidRoleNames(),
                });
                return;
            }

            // Check for duplicate username/email
            const existing = await prisma.user.findFirst({
                where: { OR: [{ username }, { email }] },
            });
            if (existing) {
                res.status(409).json({ error: "Username or email already exists." });
                return;
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 12);

            const user = await prisma.user.create({
                data: {
                    username,
                    email,
                    fullName,
                    badgeNumber: badgeNumber ?? null,
                    department: department ?? null,
                    role: canonicalRole,
                    passwordHash,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    fullName: true,
                    role: true,
                    department: true,
                    createdAt: true,
                },
            });

            res.status(201).json({ success: true, user });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to create user", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login — authenticate and receive JWT
// ---------------------------------------------------------------------------
router.post("/login", async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            res.status(400).json({ error: "Username and password are required." });
            return;
        }

        const user = await prisma.user.findUnique({ where: { username } });

        if (!user || !user.isActive) {
            await audit(req, { action: "LOGIN_FAILED", username, statusCode: 401, details: { reason: "unknown_or_inactive_user" } });
            res.status(401).json({ error: "Invalid credentials." });
            return;
        }

        const passwordValid = await bcrypt.compare(password, user.passwordHash);
        if (!passwordValid) {
            await audit(req, { action: "LOGIN_FAILED", userId: user.id, username, role: user.role, statusCode: 401, details: { reason: "bad_password" } });
            res.status(401).json({ error: "Invalid credentials." });
            return;
        }

        // Generate JWT with timeout from config. The jti lets logout revoke this exact token.
        const secret = getJwtSecret();
        const timeoutMin = getSessionTimeout();
        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            secret,
            { expiresIn: `${timeoutMin}m`, jwtid: randomUUID() }
        );

        await audit(req, { action: "LOGIN", userId: user.id, username: user.username, role: user.role, statusCode: 200 });

        res.json({
            success: true,
            token,
            expires_in: `${timeoutMin} minutes`,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                department: user.department,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: "Login failed", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout — revoke the current token server-side
// ---------------------------------------------------------------------------
router.post("/logout", authenticate, async (req: Request, res: Response) => {
    try {
        const { jti, exp } = req.tokenInfo!;
        const expiresAt = exp ? new Date(exp * 1000) : new Date(Date.now() + getSessionTimeout() * 60 * 1000);

        await prisma.revokedToken.upsert({
            where: { jti },
            create: { jti, userId: req.user!.id, expiresAt },
            update: {},
        });
        // Housekeeping: revoked tokens that have expired anyway are no longer needed
        await prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });

        await audit(req, { action: "LOGOUT", statusCode: 200 });
        res.json({ success: true, message: "Logged out. This token can no longer be used." });
    } catch (err: any) {
        res.status(500).json({ error: "Logout failed", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me — get current user profile
// ---------------------------------------------------------------------------
router.get("/me", authenticate, async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: {
                id: true,
                username: true,
                email: true,
                fullName: true,
                badgeNumber: true,
                department: true,
                role: true,
                mfaEnabled: true,
                isActive: true,
                createdAt: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: "User not found." });
            return;
        }

        res.json({ user });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to fetch profile", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/seed — create the demo users (only if no users exist)
// ---------------------------------------------------------------------------
router.post("/seed", async (req: Request, res: Response) => {
    try {
        const count = await prisma.user.count();
        if (count > 0) {
            res.status(400).json({ error: "Users already exist. Seed is only for initial setup." });
            return;
        }

        const result = await seedDemoUsers();

        res.status(201).json({
            success: true,
            message: "Demo users created. Login with any of the usernames/passwords below.",
            users: result.created,
        });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to seed", details: err.message });
    }
});

export default router;
