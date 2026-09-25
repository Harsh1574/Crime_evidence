/**
 * Disposal queue across all evidence — lets the JUDGE find and decide pending requests.
 */
import { Router, Request, Response } from "express";
import { authenticate, requireAnyPermission, prisma } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import { DISPOSAL_INCLUDE, reviewDisposal } from "../services/disposal.js";

const router = Router();

// GET /api/v1/disposals?status=pending
router.get("/", authenticate, requireAnyPermission("approve_disposal", "request_disposal", "view_all_evidence"), async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string | undefined)?.toLowerCase();
    const requests = await prisma.destructionRequest.findMany({
      where: status ? { status: status === "denied" ? "rejected" : status } : {},
      include: DISPOSAL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json({ total: requests.length, requests });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch disposal requests", details: err.message });
  }
});

// POST /api/v1/disposals/:id/approve — Body: { note } (mandatory)
router.post("/:id/approve", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(await reviewDisposal(req.params.id as string, "approved", req.body.note ?? req.body.reviewNotes, req.user!));
  } catch (err: any) {
    sendError(res, err, "Failed to approve disposal");
  }
});

// POST /api/v1/disposals/:id/reject — Body: { note }
router.post("/:id/reject", authenticate, async (req: Request, res: Response) => {
  try {
    res.json(await reviewDisposal(req.params.id as string, "rejected", req.body.note ?? req.body.reviewNotes, req.user!));
  } catch (err: any) {
    sendError(res, err, "Failed to reject disposal");
  }
});

export default router;
