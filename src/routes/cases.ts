/**
 * Cases routes — CRUD for Case entities (links CrimeBoxes) and case officers.
 */
import { Router, Request, Response } from "express";
import { authenticate, requireAnyPermission, requirePermission, prisma } from "../middleware/auth.js";
import { canViewAllEvidence, nextSequence, resolveUser } from "../services/evidence.js";
import { logActivity, notifyUsers } from "../services/notifications.js";

const router = Router();

const USER_SUMMARY = { select: { id: true, username: true, fullName: true, role: true, department: true } } as const;

const CASE_INCLUDE = {
  createdBy: { select: { id: true, username: true, fullName: true } },
  crimeBoxes: { select: { id: true, name: true, caseRefId: true, createdAt: true } },
  officers: { include: { user: USER_SUMMARY }, orderBy: { createdAt: "asc" as const } },
  _count: { select: { evidence: true } },
};

/** Can this user see the case? (creator, assigned officer, holder of case evidence, or view-all role) */
async function canAccessCase(user: { id: string; role: string }, caseId: string): Promise<boolean> {
  if (canViewAllEvidence(user.role)) return true;
  const match = await prisma.case.count({
    where: {
      id: caseId,
      OR: [
        { createdById: user.id },
        { officers: { some: { userId: user.id } } },
        { evidence: { some: { OR: [{ collectedById: user.id }, { currentCustodianId: user.id }] } } },
      ],
    },
  });
  return match > 0;
}

/** Case officers can only be managed by the case creator or an admin */
function canManageOfficers(user: { id: string; role: string }, caseRow: { createdById: string }): boolean {
  return caseRow.createdById === user.id || user.role === "admin";
}

/** Find a case by UUID or case number */
async function findCase(ref: string) {
  return prisma.case.findFirst({ where: { OR: [{ id: ref }, { caseNumber: ref }] } });
}

// GET /api/v1/cases
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    let where: any = {};

    if (!canViewAllEvidence(user.role)) {
      // Non-admin users only see cases they created, cases they are assigned to,
      // or cases linked to evidence they collected or currently hold custody of.
      where = {
        OR: [
          { createdById: user.id },
          { officers: { some: { userId: user.id } } },
          { evidence: { some: { OR: [{ collectedById: user.id }, { currentCustodianId: user.id }] } } },
        ],
      };
    }

    const cases = await prisma.case.findMany({
      where,
      include: CASE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(cases);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch cases", details: err.message });
  }
});

// POST /api/v1/cases
router.post("/", authenticate, requireAnyPermission("create_cases", "register_evidence"), async (req: Request, res: Response) => {
  try {
    const { title, description, status } = req.body;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const caseNumber = await nextSequence("CASE");
    const newCase = await prisma.case.create({
      data: { caseNumber, title, description: description ?? null, status: status ?? "open", createdById: req.user!.id },
      include: CASE_INCLUDE,
    });
    await logActivity(req.user!, "created_case", "Case", newCase.id, `${caseNumber} — ${newCase.title}`);
    res.status(201).json(newCase);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create case", details: err.message });
  }
});

// GET /api/v1/cases/:id — by UUID or case number
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const found = await findCase(req.params.id as string);
    if (!found) { res.status(404).json({ error: "Case not found" }); return; }
    if (!(await canAccessCase(req.user!, found.id))) {
      res.status(403).json({ error: "You are not assigned to this case." }); return;
    }
    const caseData = await prisma.case.findUnique({
      where: { id: found.id },
      include: {
        ...CASE_INCLUDE,
        evidence: {
          select: { id: true, evidenceNumber: true, type: true, description: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    res.json(caseData);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch case", details: err.message });
  }
});

// PUT /api/v1/cases/:id
router.put("/:id", authenticate, requirePermission("manage_cases"), async (req: Request, res: Response) => {
  try {
    const found = await findCase(req.params.id as string);
    if (!found) { res.status(404).json({ error: "Case not found" }); return; }
    if (!(await canAccessCase(req.user!, found.id))) {
      res.status(403).json({ error: "You are not assigned to this case." }); return;
    }

    const { title, description, status } = req.body;
    const updated = await prisma.case.update({
      where: { id: found.id },
      data: { ...(title && { title }), ...(description !== undefined && { description }), ...(status && { status }) },
      include: CASE_INCLUDE,
    });
    await logActivity(req.user!, "updated_case", "Case", updated.id, `${updated.caseNumber ?? ""} — ${updated.title}`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update case", details: err.message });
  }
});

// GET /api/v1/cases/:id/officers
router.get("/:id/officers", authenticate, async (req: Request, res: Response) => {
  try {
    const found = await findCase(req.params.id as string);
    if (!found) { res.status(404).json({ error: "Case not found" }); return; }
    if (!(await canAccessCase(req.user!, found.id))) {
      res.status(403).json({ error: "You are not assigned to this case." }); return;
    }
    const officers = await prisma.caseOfficer.findMany({
      where: { caseId: found.id },
      include: { user: USER_SUMMARY, addedBy: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ caseId: found.id, caseNumber: found.caseNumber, officers });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch case officers", details: err.message });
  }
});

// POST /api/v1/cases/:id/officers — Body: { userId } (ID, username or email)
router.post("/:id/officers", authenticate, requirePermission("manage_case_officers"), async (req: Request, res: Response) => {
  try {
    const found = await findCase(req.params.id as string);
    if (!found) { res.status(404).json({ error: "Case not found" }); return; }
    if (!canManageOfficers(req.user!, found)) {
      res.status(403).json({ error: "Only the case creator or an admin can manage case officers." }); return;
    }

    const ref = req.body.userId ?? req.body.username;
    if (!ref) { res.status(400).json({ error: "userId is required" }); return; }
    const officer = await resolveUser(ref);
    if (!officer || !officer.isActive) { res.status(404).json({ error: "User not found or inactive." }); return; }

    const existing = await prisma.caseOfficer.findUnique({ where: { caseId_userId: { caseId: found.id, userId: officer.id } } });
    if (existing) { res.status(409).json({ error: `${officer.username} is already assigned to this case.` }); return; }

    const assignment = await prisma.caseOfficer.create({
      data: { caseId: found.id, userId: officer.id, addedById: req.user!.id },
      include: { user: USER_SUMMARY },
    });
    await logActivity(req.user!, "added_case_officer", "Case", found.id, `${officer.username} → ${found.caseNumber ?? found.title}`);
    await notifyUsers([officer.id], {
      type: "case_assignment",
      title: "Assigned to Case",
      message: `${req.user!.username} added you to case ${found.caseNumber ?? found.title}`,
      caseId: found.id,
    });
    res.status(201).json(assignment);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to add case officer", details: err.message });
  }
});

// DELETE /api/v1/cases/:id/officers/:userId
router.delete("/:id/officers/:userId", authenticate, requirePermission("manage_case_officers"), async (req: Request, res: Response) => {
  try {
    const found = await findCase(req.params.id as string);
    if (!found) { res.status(404).json({ error: "Case not found" }); return; }
    if (!canManageOfficers(req.user!, found)) {
      res.status(403).json({ error: "Only the case creator or an admin can manage case officers." }); return;
    }

    const officer = await resolveUser(req.params.userId as string);
    const assignment = officer
      ? await prisma.caseOfficer.findUnique({ where: { caseId_userId: { caseId: found.id, userId: officer.id } } })
      : null;
    if (!officer || !assignment) { res.status(404).json({ error: "User is not assigned to this case." }); return; }

    await prisma.caseOfficer.delete({ where: { id: assignment.id } });
    await logActivity(req.user!, "removed_case_officer", "Case", found.id, `${officer.username} ✕ ${found.caseNumber ?? found.title}`);
    await notifyUsers([officer.id], {
      type: "case_unassignment",
      title: "Removed from Case",
      message: `${req.user!.username} removed you from case ${found.caseNumber ?? found.title}`,
      caseId: found.id,
    });
    res.json({ success: true, removedUserId: officer.id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to remove case officer", details: err.message });
  }
});

// POST /api/v1/cases/:id/boxes — link a CrimeBox to a case
router.post("/:id/boxes", authenticate, requirePermission("register_evidence"), async (req: Request, res: Response) => {
  try {
    const { boxId } = req.body;
    if (!boxId) { res.status(400).json({ error: "boxId is required" }); return; }
    const updated = await prisma.crimeBox.update({
      where: { id: boxId },
      data: { caseRefId: req.params.id as string },
    });
    // Evidence already filed under this box's caseId now belongs to the case too
    await prisma.evidence.updateMany({ where: { caseId: updated.caseId }, data: { caseRefId: req.params.id as string } });
    res.json({ success: true, crimeBox: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to link box to case", details: err.message });
  }
});

export default router;
