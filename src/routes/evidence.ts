/**
 * Evidence management routes — CRUD, search, integrity verification.
 *
 * Evidence statuses are ALWAYS validated against demo_config.json.
 * If a status is renamed in the config, the API immediately accepts
 * the new name and rejects the old one.
 */

import { Router, Request, Response } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import { getValidStatuses, isValidStatus, isValidStatusTransition, VALID_STATUS_TRANSITIONS } from "../utils/config.js";
import { computeSHA256String, verifyHash } from "../utils/hash.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Extend Request type to support files
interface MulterRequest extends Request {
    files?: Express.Multer.File[];
}

// ESM fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

const upload = multer({ storage: storage });

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/evidence — register new evidence (with optional files)
// ---------------------------------------------------------------------------
router.post(
    "/",
    authenticate,
    requirePermission("register_evidence"),
    upload.array("files"), // Handle multiple files
    async (req: Request, res: Response) => {
        const multerReq = req as MulterRequest;
        try {
            // Multipart form data fields are strings, need to parse if JSON
            const caseId = req.body.caseId?.trim();
            const {
                type,
                description,
                collectionDate,
                location,
                tags, // might come as stringified JSON or plain text
                status,
                officerNotes,
            } = req.body;

            // Validate required fields
            if (!caseId || !type || !description || !collectionDate || !location) {
                // Clean up uploaded files if validation fails
                if (multerReq.files) {
                    multerReq.files.forEach(f => fs.unlinkSync(f.path));
                }
                res.status(400).json({
                    error: "Missing required fields",
                    required: ["caseId", "type", "description", "collectionDate", "location"],
                });
                return;
            }

            // Validate type
            const validTypes = ["Physical", "Digital", "Testimonial"];
            if (!validTypes.includes(type)) {
                if (multerReq.files) multerReq.files.forEach(f => fs.unlinkSync(f.path));
                res.status(400).json({
                    error: `Invalid evidence type "${type}"`,
                    valid_types: validTypes,
                });
                return;
            }

            // Validate status against config
            const validStatuses = getValidStatuses();
            const evidenceStatus = status ?? validStatuses[0];
            if (!isValidStatus(evidenceStatus)) {
                if (multerReq.files) multerReq.files.forEach(f => fs.unlinkSync(f.path));
                res.status(400).json({
                    error: `Invalid status "${evidenceStatus}".`,
                    valid_statuses: validStatuses,
                });
                return;
            }

            // Handle Tags parsing safely
            let parsedTags = null;
            if (tags) {
                try {
                    parsedTags = typeof tags === 'string' ? tags : JSON.stringify(tags);
                    // Check if it's actually parsable if it's a string, or just leave as string
                    // Ideally we store JSON string in DB.
                } catch (e) {
                    parsedTags = tags;
                }
            }

            // Transaction: Create Evidence + Create EvidenceFiles
            const result = await prisma.$transaction(async (tx: any) => {
                const evidence = await tx.evidence.create({
                    data: {
                        caseId,
                        type,
                        description,
                        collectionDate: new Date(collectionDate),
                        location,
                        tags: parsedTags,
                        status: evidenceStatus,
                        officerNotes: officerNotes ?? null,
                        collectedById: req.user!.id,
                        currentCustodianId: req.user!.id,
                    },
                    include: {
                        collectedBy: {
                            select: { id: true, username: true, fullName: true, role: true },
                        },
                    },
                });

                // Create EvidenceFile records
                // Create EvidenceFile records
                if (multerReq.files && Array.isArray(multerReq.files) && multerReq.files.length > 0) {
                    const filePromises = multerReq.files.map(file => {
                        // Calculate hash (optional, maybe later) but we have size/mimetype
                        return tx.evidenceFile.create({
                            data: {
                                evidenceId: evidence.id,
                                fileName: file.originalname,
                                fileSize: file.size,
                                mimeType: file.mimetype,
                                sha256Hash: "PENDING_HASH", // TODO: compute hash
                                uploadedAt: new Date(),
                            }
                        });
                    });
                    await Promise.all(filePromises);
                }

                return evidence;
            });

            // Log the action
            await prisma.accessLog.create({
                data: {
                    evidenceId: result.id,
                    userId: req.user!.id,
                    action: "register",
                    result: "success",
                    ipAddress: req.ip ?? null,
                    userAgent: req.headers["user-agent"] ?? null,
                },
            });

            res.status(201).json({ success: true, evidence: result });
        } catch (err: any) {
            // Clean up files on error
            if (multerReq.files) {
                multerReq.files.forEach(f => {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                });
            }
            res.status(500).json({ error: "Failed to register evidence", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// GET /api/v1/evidence — search/filter evidence
// ---------------------------------------------------------------------------
router.get("/", authenticate, async (req: Request, res: Response) => {
    try {
        const { caseId, type, status, search, page = "1", limit = "20" } = req.query;

        const where: any = {};
        if (caseId) where.caseId = caseId as string;
        if (type) where.type = type as string;
        if (status) {
            // Validate status against config
            if (!isValidStatus(status as string)) {
                res.status(400).json({
                    error: `Invalid status filter "${status}"`,
                    valid_statuses: getValidStatuses(),
                });
                return;
            }
            where.status = status as string;
        }
        if (search) {
            where.OR = [
                { description: { contains: search as string } },
                { caseId: { contains: search as string } },
            ];
        }

        // -----------------------------------------------------------------------
        // RBAC: Data Isolation
        // -----------------------------------------------------------------------
        const user = req.user!;
        const canViewAll = ["admin", "auditor"].includes(user.role);

        console.log(`[GET /evidence] User: ${user.username} (${user.role}), CaseID Filter: ${caseId || "NONE"}`);

        if (!canViewAll) {
            // Users can only see evidence they collected OR currently hold
            // UNLESS they are querying a specific Crime Box (Case ID).
            // Since membership is client-side key-based in this MVP, we trust knowledge of the caseId.

            if (caseId) {
                // User is querying a specific box. Allow it if they know the ID.
                // We strictly filter by this caseId.
                where.caseId = caseId as string;
                console.log(`[GET /evidence] Accessing Box: ${caseId} (Allowed)`);
            } else {
                // User is viewing their personal evidence log (no box context).
                // Restrict to what they collected or hold.
                const accessFilter = {
                    OR: [
                        { collectedById: user.id },
                        { currentCustodianId: user.id }
                    ]
                };

                if (where.OR) {
                    // If we already have an OR for search, we need to wrap everything in an AND
                    where.AND = [
                        accessFilter,
                        { OR: where.OR }
                    ];
                    delete where.OR; // Move search OR inside AND
                } else {
                    where.OR = accessFilter.OR;
                }
                console.log(`[GET /evidence] Personal Log Access (Restricted to Owner/Custodian)`);
            }
        } else {
            console.log(`[GET /evidence] Admin Access (View All)`);
        }

        const pageNum = Math.max(1, parseInt(page as string, 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
        const skip = (pageNum - 1) * pageSize;

        console.log(`[GET /evidence] Prisma Where Clause:`, JSON.stringify(where, null, 2));

        const [evidence, total] = await Promise.all([
            prisma.evidence.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { createdAt: "desc" },
                include: {
                    collectedBy: {
                        select: { id: true, username: true, fullName: true },
                    },
                    currentCustodian: {
                        select: { id: true, username: true, fullName: true },
                    },
                    _count: { select: { files: true, custodyEvents: true } },
                },
            }),
            prisma.evidence.count({ where }),
        ]);

        res.json({
            evidence,
            pagination: {
                page: pageNum,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to search evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:id — get evidence detail
// ---------------------------------------------------------------------------
router.get("/:id", authenticate, async (req: Request, res: Response) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.id as string },
            include: {
                collectedBy: {
                    select: { id: true, username: true, fullName: true, role: true, department: true },
                },
                currentCustodian: {
                    select: { id: true, username: true, fullName: true, role: true, department: true },
                },
                files: true,
                custodyEvents: {
                    orderBy: { timestamp: "asc" },
                    include: {
                        fromUser: { select: { id: true, username: true, fullName: true } },
                        toUser: { select: { id: true, username: true, fullName: true } },
                    },
                },
            },
        });

        if (!evidence) {
            res.status(404).json({ error: "Evidence not found." });
            return;
        }

        // Log access
        await prisma.accessLog.create({
            data: {
                evidenceId: evidence.id,
                userId: req.user!.id,
                action: "view",
                result: "success",
                ipAddress: req.ip ?? null,
                userAgent: req.headers["user-agent"] ?? null,
            },
        });

        res.json({ evidence });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to fetch evidence", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/evidence/:id — update evidence metadata
// ---------------------------------------------------------------------------
router.put(
    "/:id",
    authenticate,
    requirePermission("register_evidence"),
    async (req: Request, res: Response) => {
        try {
            const evidence = await prisma.evidence.findUnique({ where: { id: req.params.id as string } });

            if (!evidence) {
                res.status(404).json({ error: "Evidence not found." });
                return;
            }

            if (evidence.locked) {
                res.status(409).json({
                    error: "Evidence is locked due to a pending custody transfer.",
                    hint: "Resolve the pending transfer before modifying evidence.",
                });
                return;
            }

            const { description, tags, status, officerNotes, location } = req.body;

            // Validate status if provided
            if (status && !isValidStatus(status)) {
                res.status(400).json({
                    error: `Invalid status "${status}"`,
                    valid_statuses: getValidStatuses(),
                });
                return;
            }

            // Validate status transition if status is being changed
            if (status && status !== evidence.status && !isValidStatusTransition(evidence.status, status)) {
                res.status(400).json({
                    error: `Invalid status transition from "${evidence.status}" to "${status}"`,
                    current_status: evidence.status,
                    valid_transitions: VALID_STATUS_TRANSITIONS[evidence.status] || [],
                });
                return;
            }

            const updated = await prisma.evidence.update({
                where: { id: req.params.id as string },
                data: {
                    ...(description !== undefined && { description }),
                    ...(tags !== undefined && { tags: JSON.stringify(tags) }),
                    ...(status !== undefined && { status }),
                    ...(officerNotes !== undefined && { officerNotes }),
                    ...(location !== undefined && { location }),
                },
            });

            // Log modification
            await prisma.accessLog.create({
                data: {
                    evidenceId: evidence.id,
                    userId: req.user!.id,
                    action: "modify",
                    result: "success",
                    ipAddress: req.ip ?? null,
                    userAgent: req.headers["user-agent"] ?? null,
                },
            });

            res.json({ success: true, evidence: updated });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to update evidence", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/verify — verify file integrity
// ---------------------------------------------------------------------------
router.post("/:id/verify", authenticate, async (req: Request, res: Response) => {
    try {
        const evidence = await prisma.evidence.findUnique({
            where: { id: req.params.id as string },
            include: { files: true },
        });

        if (!evidence) {
            res.status(404).json({ error: "Evidence not found." });
            return;
        }

        const { fileContent } = req.body; // base64 encoded file for verification

        let integrityResult;
        if (fileContent && evidence.fileHash) {
            const buffer = Buffer.from(fileContent, "base64");
            const matches = verifyHash(buffer, evidence.fileHash);
            integrityResult = {
                status: matches ? "PASS" : "FAIL",
                expectedHash: evidence.fileHash,
                actualHash: computeSHA256String(fileContent),
                verified: matches,
            };
        } else {
            integrityResult = {
                status: evidence.fileHash ? "NO_FILE_PROVIDED" : "NO_HASH_RECORDED",
                expectedHash: evidence.fileHash,
                message: evidence.fileHash
                    ? "Provide fileContent (base64) to verify against stored hash."
                    : "No file hash was recorded for this evidence.",
            };
        }

        res.json({
            evidenceId: evidence.id,
            caseId: evidence.caseId,
            integrity: integrityResult,
            files: evidence.files.map((f: any) => ({
                id: f.id,
                fileName: f.fileName,
                sha256Hash: f.sha256Hash,
            })),
        });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to verify integrity", details: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/v1/evidence/:evidenceId/files/:fileId/download — download an attached file
// ---------------------------------------------------------------------------
router.get(
    "/:evidenceId/files/:fileId/download",
    authenticate,
    async (req: Request, res: Response) => {
        try {
            const { evidenceId, fileId } = req.params;

            // Check if evidence exists and user has access (basic check for now)
            const evidence = await prisma.evidence.findUnique({
                where: { id: evidenceId as string },
            });

            if (!evidence) {
                res.status(404).json({ error: "Evidence not found" });
                return;
            }

            // Find the file record
            const fileRecord = await prisma.evidenceFile.findUnique({
                where: { id: fileId as string, evidenceId: evidenceId as string },
            });

            if (!fileRecord) {
                res.status(404).json({ error: "File record not found" });
                return;
            }

            // Construct file path
            const filePath = path.join(process.cwd(), "uploads", fileRecord.fileName);

            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: "Physical file not found on server" });
                return;
            }

            // Download
            res.download(filePath, fileRecord.fileName);

        } catch (err: any) {
            res.status(500).json({ error: "Failed to download file", details: err.message });
        }
    }
);

export default router;
