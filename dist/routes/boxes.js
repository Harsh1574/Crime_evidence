import { Router } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import crypto from "crypto";
import { hasPermission } from "../utils/config.js";
const router = Router();
// Helper to generate keys
const generateKeys = () => {
    const privateKey = `PRI-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const publicKey = `PUB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    return { privateKey, publicKey };
};
// ---------------------------------------------------------------------------
// POST /api/v1/boxes — Create a new Crime Box
// ---------------------------------------------------------------------------
router.post("/", authenticate, requirePermission("create_crime_box"), async (req, res) => {
    try {
        const name = req.body.name?.trim();
        const caseId = req.body.caseId?.trim();
        if (!name || !caseId) {
            res.status(400).json({ error: "Name and Case ID are required." });
            return;
        }
        // Check if Case ID already exists
        const existing = await prisma.crimeBox.findUnique({
            where: { caseId },
        });
        if (existing) {
            res.status(409).json({ error: "Case ID already exists." });
            return;
        }
        const { privateKey, publicKey } = generateKeys();
        const box = await prisma.crimeBox.create({
            data: {
                name,
                caseId,
                privateKey,
                publicKey,
                createdById: req.user.id,
            },
        });
        res.status(201).json({ success: true, box });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to create Crime Box", details: err.message });
    }
});
// ---------------------------------------------------------------------------
// POST /api/v1/boxes/join — Join a Crime Box using a key
// ---------------------------------------------------------------------------
router.post("/join", authenticate, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) {
            res.status(400).json({ error: "Key is required." });
            return;
        }
        // Find box by either key
        const box = await prisma.crimeBox.findFirst({
            where: {
                OR: [{ privateKey: key }, { publicKey: key }],
            },
            include: {
                createdBy: {
                    select: { id: true, fullName: true, department: true },
                },
            },
        });
        if (!box) {
            res.status(404).json({ error: "Invalid Key. No Crime Box found." });
            return;
        }
        const isPrivate = box.privateKey === key;
        const userRole = req.user.role;
        // Role-based Key Validation
        let permission = "read-only";
        if (isPrivate) {
            // Read-write access is for roles that can register evidence
            // (officer, head officer, collector, admin). Everyone else must use the public key.
            if (!hasPermission(userRole, "register_evidence")) {
                res.status(403).json({
                    error: "This role cannot use the private key. Join with the public key for read-only access.",
                });
                return;
            }
            permission = "read-write";
        }
        // Sanitize - strip raw keys from the response.
        // The joiner already knows the key they used; no need to echo them back.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { privateKey: _pk, publicKey: _pub, ...safeBox } = box;
        // Return box details + permission
        res.json({
            success: true,
            box: safeBox,
            permission,
            accessType: isPrivate ? "private" : "public",
        });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to join Crime Box", details: err.message });
    }
});
export default router;
//# sourceMappingURL=boxes.js.map