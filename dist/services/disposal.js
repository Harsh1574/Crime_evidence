/**
 * Evidence disposal workflow.
 *
 *   request (request_disposal, e.g. PROSECUTOR)
 *     → pending → approve (approve_disposal, JUDGE only, note mandatory) → evidence DISPOSED
 *               → reject  (approve_disposal)                             → evidence unchanged
 *
 * Stored in the DestructionRequest table (the original "destruction" routes use it too).
 */
import { prisma } from "../lib/prisma.js";
import { getLifecycleConfig, hasPermission } from "../utils/config.js";
import { recordEvidenceChange, ServiceError, TERMINAL_STATUSES } from "./evidence.js";
import { logActivity, notifyPermissionHolders, notifyUsers } from "./notifications.js";
export const DISPOSAL_INCLUDE = {
    requester: { select: { id: true, username: true, fullName: true, role: true } },
    reviewer: { select: { id: true, username: true, fullName: true, role: true } },
    evidence: { select: { id: true, evidenceNumber: true, caseId: true, type: true, description: true, status: true } },
};
export async function requestDisposal(evidenceId, reason, actor) {
    if (!hasPermission(actor.role, "request_disposal")) {
        throw new ServiceError(403, "Insufficient permissions.", { required: ["request_disposal"] });
    }
    if (!reason?.trim())
        throw new ServiceError(400, "reason is required");
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence)
        throw new ServiceError(404, "Evidence not found");
    if (TERMINAL_STATUSES.includes(evidence.status)) {
        throw new ServiceError(409, `Evidence is already ${evidence.status}`);
    }
    const existing = await prisma.destructionRequest.findFirst({ where: { evidenceId, status: "pending" } });
    if (existing)
        throw new ServiceError(409, "There is already a pending disposal request for this evidence");
    const requiresApproval = getLifecycleConfig().destruction_requires_approval ?? true;
    const request = await prisma.destructionRequest.create({
        data: { evidenceId, requesterId: actor.id, reason: reason.trim(), status: "pending" },
    });
    await logActivity(actor, "requested_disposal", "Evidence", evidenceId, evidence.evidenceNumber);
    await recordEvidenceChange(evidenceId, { action: "DISPOSAL_REQUESTED", actor, notes: reason.trim() });
    if (!requiresApproval) {
        return reviewDisposal(request.id, "approved", "Auto-approved (destruction_requires_approval=false)", actor, true);
    }
    await notifyPermissionHolders("approve_disposal", {
        type: "disposal_request",
        title: "Disposal Request Awaiting Decision",
        message: `${actor.username} requested disposal of ${evidence.evidenceNumber ?? "evidence"}: ${reason.trim()}`,
        evidenceId,
    }, actor.id);
    return prisma.destructionRequest.findUnique({ where: { id: request.id }, include: DISPOSAL_INCLUDE });
}
/** Map API decision words onto the stored status */
function normalizeDecision(decision) {
    const d = decision?.toLowerCase();
    if (d === "approved" || d === "approve")
        return "approved";
    if (d === "rejected" || d === "reject" || d === "denied" || d === "deny")
        return "rejected";
    return null;
}
export async function reviewDisposal(requestId, decisionInput, reviewNotes, actor, skipPermissionCheck = false) {
    if (!skipPermissionCheck && !hasPermission(actor.role, "approve_disposal")) {
        throw new ServiceError(403, "Only a JUDGE can approve or reject disposal requests.", { required: ["approve_disposal"] });
    }
    const decision = normalizeDecision(decisionInput);
    if (!decision)
        throw new ServiceError(400, "status must be approved or rejected");
    const note = reviewNotes?.trim();
    if (decision === "approved" && !note) {
        throw new ServiceError(400, "A review note is mandatory when approving a disposal.");
    }
    const request = await prisma.destructionRequest.findUnique({ where: { id: requestId }, include: { evidence: true } });
    if (!request)
        throw new ServiceError(404, "Disposal request not found");
    if (request.status !== "pending")
        throw new ServiceError(409, `Request already ${request.status}`);
    if (decision === "approved" && request.evidence.locked) {
        throw new ServiceError(409, "Evidence has a pending custody transfer. Resolve it before disposal.");
    }
    const now = new Date();
    let certificate = null;
    if (decision === "approved" && (getLifecycleConfig().certificate_of_destruction ?? true)) {
        certificate = await buildDisposalCertificate(request.evidenceId, actor, request.reason, note, now);
    }
    await prisma.$transaction([
        prisma.destructionRequest.update({
            where: { id: requestId },
            data: { status: decision, reviewNotes: note ?? null, reviewerId: actor.id, reviewedAt: now, certificate },
        }),
        ...(decision === "approved"
            ? [prisma.evidence.update({ where: { id: request.evidenceId }, data: { status: "Disposed" } })]
            : []),
    ]);
    await logActivity(actor, decision === "approved" ? "approved_disposal" : "rejected_disposal", "Evidence", request.evidenceId, request.evidence.evidenceNumber);
    const anchoring = await recordEvidenceChange(request.evidenceId, {
        action: decision === "approved" ? "DISPOSED" : "DISPOSAL_REJECTED",
        actor,
        notes: note ?? null,
    });
    await notifyUsers([request.requesterId, request.evidence.currentCustodianId, request.evidence.collectedById], {
        type: "disposal_decision",
        title: `Disposal Request ${decision === "approved" ? "Approved" : "Rejected"}`,
        message: `Disposal of ${request.evidence.evidenceNumber ?? "evidence"} was ${decision} by ${actor.username}${note ? `: ${note}` : ""}`,
        evidenceId: request.evidenceId,
    });
    const updated = await prisma.destructionRequest.findUnique({ where: { id: requestId }, include: DISPOSAL_INCLUDE });
    return { ...updated, anchoring };
}
async function buildDisposalCertificate(evidenceId, reviewer, reason, note, when) {
    const evidence = await prisma.evidence.findUnique({
        where: { id: evidenceId },
        include: { collectedBy: { select: { fullName: true, badgeNumber: true, department: true } }, files: true },
    });
    return JSON.stringify({
        certificateType: "Certificate of Disposal",
        evidenceId: evidence?.evidenceNumber ?? evidenceId,
        systemId: evidenceId,
        evidenceType: evidence?.type,
        caseId: evidence?.caseId,
        description: evidence?.description,
        collectedBy: evidence?.collectedBy?.fullName ?? "Unknown",
        collectedByBadge: evidence?.collectedBy?.badgeNumber ?? "N/A",
        department: evidence?.collectedBy?.department ?? "N/A",
        disposalDate: when.toISOString(),
        disposalReason: reason,
        approvedBy: reviewer.username,
        approvalNote: note,
        fileHashes: evidence?.files?.map((f) => f.sha256Hash) ?? [],
        metadataHash: evidence?.metadataHash,
        lastLedgerTxId: evidence?.ledgerTxId,
        certificateHash: `DISP-${evidenceId}-${when.getTime()}`,
    }, null, 2);
}
//# sourceMappingURL=disposal.js.map