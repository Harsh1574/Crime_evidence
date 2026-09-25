/**
 * Custody transfer routes with evidence locking.
 *
 * Flow:
 * 1. Initiate → evidence.locked = true, event.status = 'pending'
 * 2. Approve  → evidence.locked = false, custody transferred, signature required
 * 3. Reject   → evidence.locked = false, no custody change
 *
 * Attempting a second transfer while locked → 409 Conflict
 */

import { Router, Request, Response } from "express";
import { authenticate, requirePermission, prisma } from "../middleware/auth.js";
import { generateCustodySignature } from "../utils/hash.js";
import { sendError } from "../utils/http.js";
import { initiateTransfer, recordEvidenceChange } from "../services/evidence.js";
import { logActivity, notifyUsers } from "../services/notifications.js";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/evidence/:id/transfer — initiate custody transfer
// ---------------------------------------------------------------------------
router.post(
    "/evidence/:id/transfer",
    authenticate,
    requirePermission("transfer_evidence"),
    async (req: Request, res: Response) => {
        try {
            const { toUserId, reason } = req.body;
            const { custodyEvent, recipient } = await initiateTransfer(req.params.id as string, toUserId, reason, req.user!);

            res.status(201).json({
                success: true,
                message: "Custody transfer initiated. Evidence is now locked.",
                transfer: {
                    id: custodyEvent.id,
                    evidenceId: custodyEvent.evidenceId,
                    fromUserId: req.user!.id,
                    toUserId: recipient.id,
                    status: "pending",
                    locked: true,
                },
            });
        } catch (err: any) {
            sendError(res, err, "Failed to initiate transfer");
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/custody/transfer/:id/approve — approve pending transfer
// Requires mandatory signature
// ---------------------------------------------------------------------------
router.post(
    "/transfer/:id/approve",
    authenticate,
    requirePermission("accept_transfers"),
    async (req: Request, res: Response) => {
        try {
            const { signature } = req.body;

            // Signature is MANDATORY for approval
            if (!signature) {
                res.status(400).json({
                    error: "Signature is required to approve a custody transfer.",
                    hint: "Provide a digital signature or verification hash in the 'signature' field.",
                });
                return;
            }

            const event = await prisma.custodyEvent.findUnique({
                where: { id: req.params.id as string },
                include: { evidence: true },
            });

            if (!event) {
                res.status(404).json({ error: "Transfer event not found." });
                return;
            }

            if (event.status !== "pending") {
                res.status(400).json({
                    error: `Transfer has already been ${event.status}.`,
                });
                return;
            }

            // Only the recipient can approve
            if (event.toUserId !== req.user!.id) {
                res.status(403).json({
                    error: "Only the designated recipient can approve this transfer.",
                });
                return;
            }

            // Generate chain signature (links to previous state)
            const chainSignature = generateCustodySignature({
                evidenceId: event.evidenceId,
                fromUserId: event.fromUserId,
                toUserId: event.toUserId,
                timestamp: new Date().toISOString(),
                previousSignature: signature,
            });

            // Approve: update event, transfer custody, unlock evidence
            const [updatedEvent, updatedEvidence] = await prisma.$transaction([
                prisma.custodyEvent.update({
                    where: { id: event.id },
                    data: {
                        status: "approved",
                        signature: chainSignature,
                    },
                }),
                prisma.evidence.update({
                    where: { id: event.evidenceId },
                    data: {
                        locked: false,
                        currentCustodianId: event.toUserId,
                    },
                }),
            ]);

            await prisma.accessLog.create({
                data: { evidenceId: event.evidenceId, userId: req.user!.id, action: "transfer_accept", result: "success" },
            });
            await logActivity(req.user!, "accepted_transfer", "Evidence", event.evidenceId, event.evidence.evidenceNumber);
            await notifyUsers([event.fromUserId], {
                type: "transfer_accepted",
                title: "Custody Transfer Accepted",
                message: `${req.user!.username} accepted custody of ${event.evidence.evidenceNumber ?? "evidence"}`,
                evidenceId: event.evidenceId,
            });
            const anchoring = await recordEvidenceChange(event.evidenceId, {
                action: "TRANSFER_ACCEPTED",
                actor: req.user!,
                notes: `Custody now with ${req.user!.username}`,
            });

            res.json({
                success: true,
                anchoring,
                message: "Custody transfer approved. Evidence unlocked.",
                transfer: {
                    id: updatedEvent.id,
                    status: "approved",
                    signature: chainSignature,
                    newCustodianId: event.toUserId,
                    locked: false,
                },
            });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to approve transfer", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/v1/custody/transfer/:id/reject — reject pending transfer
// ---------------------------------------------------------------------------
router.post(
    "/transfer/:id/reject",
    authenticate,
    requirePermission("accept_transfers"),
    async (req: Request, res: Response) => {
        try {
            const { reason } = req.body;

            if (!reason) {
                res.status(400).json({ error: "Reason is required to reject a transfer." });
                return;
            }

            const event = await prisma.custodyEvent.findUnique({
                where: { id: req.params.id as string },
                include: { evidence: { select: { evidenceNumber: true } } },
            });

            if (!event) {
                res.status(404).json({ error: "Transfer event not found." });
                return;
            }

            if (event.status !== "pending") {
                res.status(400).json({
                    error: `Transfer has already been ${event.status}.`,
                });
                return;
            }

            // Only the recipient can reject
            if (event.toUserId !== req.user!.id) {
                res.status(403).json({
                    error: "Only the designated recipient can reject this transfer.",
                });
                return;
            }

            // Reject: update event and unlock evidence
            const [updatedEvent, updatedEvidence] = await prisma.$transaction([
                prisma.custodyEvent.update({
                    where: { id: event.id },
                    data: { status: "rejected", reason: `${event.reason} | Rejected: ${reason}` },
                }),
                prisma.evidence.update({
                    where: { id: event.evidenceId },
                    data: { locked: false },
                }),
            ]);

            await prisma.accessLog.create({
                data: { evidenceId: event.evidenceId, userId: req.user!.id, action: "transfer_reject", result: "success" },
            });
            await logActivity(req.user!, "rejected_transfer", "Evidence", event.evidenceId, event.evidence.evidenceNumber);
            await notifyUsers([event.fromUserId], {
                type: "transfer_rejected",
                title: "Custody Transfer Rejected",
                message: `${req.user!.username} rejected the transfer of ${event.evidence.evidenceNumber ?? "evidence"}: ${reason}`,
                evidenceId: event.evidenceId,
            });
            const anchoring = await recordEvidenceChange(event.evidenceId, {
                action: "TRANSFER_REJECTED",
                actor: req.user!,
                notes: reason,
            });

            res.json({
                success: true,
                anchoring,
                message: "Custody transfer rejected. Evidence unlocked.",
                transfer: {
                    id: updatedEvent.id,
                    status: "rejected",
                    locked: false,
                },
            });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to reject transfer", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// GET /api/v1/custody/:evidenceId/history — full chain of custody timeline
// ---------------------------------------------------------------------------
router.get(
    "/:evidenceId/history",
    authenticate,
    async (req: Request, res: Response) => {
        try {
            const evidence = await prisma.evidence.findUnique({
                where: { id: req.params.evidenceId as string },
                select: { id: true, caseId: true, status: true, locked: true },
            });

            if (!evidence) {
                res.status(404).json({ error: "Evidence not found." });
                return;
            }

            const events = await prisma.custodyEvent.findMany({
                where: { evidenceId: req.params.evidenceId as string },
                orderBy: { timestamp: "asc" },
                include: {
                    fromUser: { select: { id: true, username: true, fullName: true, role: true } },
                    toUser: { select: { id: true, username: true, fullName: true, role: true } },
                },
            });

            res.json({
                evidence,
                chain_of_custody: events,
                total_events: events.length,
            });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to fetch custody history", details: err.message });
        }
    }
);

// ---------------------------------------------------------------------------
// GET /api/v1/custody/pending — get pending transfers for current user
// ---------------------------------------------------------------------------
router.get(
    "/pending",
    authenticate,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user!.id;

            const [incoming, outgoing] = await Promise.all([
                // Incoming: I am the recipient, waiting for ME to approve
                prisma.custodyEvent.findMany({
                    where: {
                        toUserId: userId,
                        status: "pending",
                    },
                    include: {
                        evidence: { select: { id: true, caseId: true, type: true, description: true } },
                        fromUser: { select: { id: true, username: true, fullName: true, department: true } },
                    },
                    orderBy: { timestamp: "desc" },
                }),
                // Outgoing: I initiated, waiting for THEM to approve
                prisma.custodyEvent.findMany({
                    where: {
                        fromUserId: userId,
                        status: "pending",
                    },
                    include: {
                        evidence: { select: { id: true, caseId: true, type: true, description: true } },
                        toUser: { select: { id: true, username: true, fullName: true, department: true } },
                    },
                    orderBy: { timestamp: "desc" },
                }),
            ]);

            res.json({ incoming, outgoing });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to fetch pending transfers", details: err.message });
        }
    }
);

export default router;
