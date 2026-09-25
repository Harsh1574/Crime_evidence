import { Router } from "express";
import { authenticate, prisma } from "../middleware/auth.js";
import { canViewAllEvidence, evidenceVisibilityWhere } from "../services/evidence.js";
const router = Router();
// GET /api/v1/stats — dashboard statistics with chart data
router.get("/", authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const viewAll = canViewAllEvidence(req.user.role);
        // Same visibility rules as the evidence list
        const evidenceFilter = (await evidenceVisibilityWhere(req.user)) ?? {};
        const caseFilter = viewAll ? {} : {
            OR: [
                { createdById: userId },
                { officers: { some: { userId } } },
                { evidence: { some: { OR: [{ collectedById: userId }, { currentCustodianId: userId }] } } },
            ],
        };
        // Basic counts
        const [totalEvidence, pendingTransfers, totalCases, totalLabs, pendingDisposals] = await Promise.all([
            prisma.evidence.count({ where: evidenceFilter }),
            prisma.custodyEvent.count({ where: { toUserId: userId, status: "pending" } }),
            prisma.case.count({ where: caseFilter }),
            prisma.labResult.count({ where: viewAll ? {} : { submittedById: userId } }),
            prisma.destructionRequest.count({ where: { status: "pending" } }),
        ]);
        // Evidence by status
        const evidenceByStatus = await prisma.evidence.groupBy({
            by: ["status"],
            where: evidenceFilter,
            _count: { id: true },
        });
        // Evidence by type
        const evidenceByType = await prisma.evidence.groupBy({
            by: ["type"],
            where: evidenceFilter,
            _count: { id: true },
        });
        // Evidence submitted in last 7 days (per day)
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentEvidence = await prisma.evidence.findMany({
            where: {
                ...evidenceFilter,
                createdAt: { gte: sevenDaysAgo }
            },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
        });
        // Bucket by day
        const dayBuckets = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split("T")[0];
            dayBuckets[key] = 0;
        }
        for (const ev of recentEvidence) {
            const key = ev.createdAt.toISOString().split("T")[0];
            if (key in dayBuckets)
                dayBuckets[key]++;
        }
        const evidenceOverTime = Object.entries(dayBuckets).map(([date, count]) => ({ date, count }));
        // Pending access requests
        const pendingAccessRequests = await prisma.evidenceAccessRequest.count({ where: { status: "pending" } });
        // Unread notifications count
        const unreadNotifications = await prisma.notification.count({ where: { userId, read: false } });
        res.json({
            totalEvidence,
            pendingTransfers,
            totalCases,
            totalLabs,
            pendingAccessRequests,
            pendingDisposals,
            unreadNotifications,
            evidenceByStatus: evidenceByStatus.map(e => ({ status: e.status, count: e._count.id })),
            evidenceByType: evidenceByType.map(e => ({ type: e.type, count: e._count.id })),
            evidenceOverTime,
        });
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch stats", details: err.message });
    }
});
export default router;
//# sourceMappingURL=stats.js.map