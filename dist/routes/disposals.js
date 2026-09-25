/**
 * Disposal queue across all evidence — lets the JUDGE find and decide pending requests.
 */
import { Router } from "express";
import { authenticate, requireAnyPermission, prisma } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import { DISPOSAL_INCLUDE, reviewDisposal } from "../services/disposal.js";
const router = Router();
// GET /api/v1/disposals?status=pending
router.get("/", authenticate, requireAnyPermission("approve_disposal", "request_disposal", "view_all_evidence"), async (req, res) => {
    try {
        const status = req.query.status?.toLowerCase();
        const requests = await prisma.destructionRequest.findMany({
            where: status ? { status: status === "denied" ? "rejected" : status } : {},
            include: DISPOSAL_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
        res.json({ total: requests.length, requests });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch disposal requests", details: err.message });
    }
});
// POST /api/v1/disposals/:id/approve — Body: { note } (mandatory)
router.post("/:id/approve", authenticate, async (req, res) => {
    try {
        res.json(await reviewDisposal(req.params.id, "approved", req.body.note ?? req.body.reviewNotes, req.user));
    }
    catch (err) {
        sendError(res, err, "Failed to approve disposal");
    }
});
// POST /api/v1/disposals/:id/reject — Body: { note }
router.post("/:id/reject", authenticate, async (req, res) => {
    try {
        res.json(await reviewDisposal(req.params.id, "rejected", req.body.note ?? req.body.reviewNotes, req.user));
    }
    catch (err) {
        sendError(res, err, "Failed to reject disposal");
    }
});
export default router;
//# sourceMappingURL=disposals.js.map