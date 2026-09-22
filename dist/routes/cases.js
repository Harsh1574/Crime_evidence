/**
 * Cases routes — CRUD for Case entities (links CrimeBoxes).
 */
import { Router } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
const router = Router();
// GET /api/v1/cases
router.get("/", authenticate, async (req, res) => {
    try {
        const user = req.user;
        const canViewAll = ["admin", "auditor"].includes(user.role);
        let where = {};
        if (!canViewAll) {
            // Non-admin users only see cases they created OR cases linked to
            // evidence they collected or currently hold custody of.
            const linkedCaseIds = await prisma.evidence.findMany({
                where: {
                    OR: [
                        { collectedById: user.id },
                        { currentCustodianId: user.id },
                    ],
                },
                select: { caseId: true },
                distinct: ["caseId"],
            });
            const caseIds = linkedCaseIds.map((e) => e.caseId);
            where = {
                OR: [
                    { createdById: user.id },
                    ...(caseIds.length > 0 ? [{ id: { in: caseIds } }] : []),
                ],
            };
        }
        const cases = await prisma.case.findMany({
            where,
            include: {
                createdBy: { select: { id: true, username: true, fullName: true } },
                crimeBoxes: { select: { id: true, name: true, caseRefId: true, createdAt: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(cases);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch cases", details: err.message });
    }
});
// POST /api/v1/cases
router.post("/", authenticate, requirePermission("register_evidence"), async (req, res) => {
    try {
        const { title, description, status } = req.body;
        if (!title) {
            res.status(400).json({ error: "title is required" });
            return;
        }
        const newCase = await prisma.case.create({
            data: { title, description: description ?? null, status: status ?? "open", createdById: req.user.id },
        });
        // Activity log
        await prisma.activityLog.create({
            data: { actorId: req.user.id, actorName: req.user.username, action: "created_case", entityType: "Case", entityId: newCase.id, entityLabel: newCase.title },
        });
        res.status(201).json(newCase);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to create case", details: err.message });
    }
});
// GET /api/v1/cases/:id
router.get("/:id", authenticate, async (req, res) => {
    try {
        const caseData = await prisma.case.findUnique({
            where: { id: req.params.id },
            include: {
                createdBy: { select: { id: true, username: true, fullName: true } },
                crimeBoxes: { select: { id: true, name: true, caseRefId: true, createdAt: true } },
            },
        });
        if (!caseData) {
            res.status(404).json({ error: "Case not found" });
            return;
        }
        res.json(caseData);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch case", details: err.message });
    }
});
// PUT /api/v1/cases/:id
router.put("/:id", authenticate, requirePermission("manage_cases"), async (req, res) => {
    try {
        const { title, description, status } = req.body;
        const updated = await prisma.case.update({
            where: { id: req.params.id },
            data: { ...(title && { title }), ...(description !== undefined && { description }), ...(status && { status }) },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to update case", details: err.message });
    }
});
// POST /api/v1/cases/:id/boxes — link a CrimeBox to a case
router.post("/:id/boxes", authenticate, requirePermission("register_evidence"), async (req, res) => {
    try {
        const { boxId } = req.body;
        if (!boxId) {
            res.status(400).json({ error: "boxId is required" });
            return;
        }
        const updated = await prisma.crimeBox.update({
            where: { id: boxId },
            data: { caseRefId: req.params.id },
        });
        res.json({ success: true, crimeBox: updated });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to link box to case", details: err.message });
    }
});
export default router;
//# sourceMappingURL=cases.js.map