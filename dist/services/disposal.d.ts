/**
 * Evidence disposal workflow.
 *
 *   request (request_disposal, e.g. PROSECUTOR)
 *     → pending → approve (approve_disposal, JUDGE only, note mandatory) → evidence DISPOSED
 *               → reject  (approve_disposal)                             → evidence unchanged
 *
 * Stored in the DestructionRequest table (the original "destruction" routes use it too).
 */
import { Actor } from "./evidence.js";
export declare const DISPOSAL_INCLUDE: {
    readonly requester: {
        readonly select: {
            readonly id: true;
            readonly username: true;
            readonly fullName: true;
            readonly role: true;
        };
    };
    readonly reviewer: {
        readonly select: {
            readonly id: true;
            readonly username: true;
            readonly fullName: true;
            readonly role: true;
        };
    };
    readonly evidence: {
        readonly select: {
            readonly id: true;
            readonly evidenceNumber: true;
            readonly caseId: true;
            readonly type: true;
            readonly description: true;
            readonly status: true;
        };
    };
};
export declare function requestDisposal(evidenceId: string, reason: string, actor: Actor): Promise<({
    evidence: {
        description: string;
        type: string;
        status: string;
        id: string;
        caseId: string;
        evidenceNumber: string | null;
    };
    requester: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    };
    reviewer: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    } | null;
} & {
    status: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    reason: string;
    evidenceId: string;
    requesterId: string;
    reviewNotes: string | null;
    reviewedAt: Date | null;
    reviewerId: string | null;
    certificate: string | null;
}) | {
    anchoring: import("./evidence.js").AnchorResult;
    evidence?: {
        description: string;
        type: string;
        status: string;
        id: string;
        caseId: string;
        evidenceNumber: string | null;
    } | undefined;
    requester?: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    } | undefined;
    reviewer?: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    } | null | undefined;
    status?: string | undefined;
    id?: string | undefined;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    reason?: string | undefined;
    evidenceId?: string | undefined;
    requesterId?: string | undefined;
    reviewNotes?: string | null | undefined;
    reviewedAt?: Date | null | undefined;
    reviewerId?: string | null | undefined;
    certificate?: string | null | undefined;
} | null>;
export declare function reviewDisposal(requestId: string, decisionInput: string, reviewNotes: string | undefined, actor: Actor, skipPermissionCheck?: boolean): Promise<{
    anchoring: import("./evidence.js").AnchorResult;
    evidence?: {
        description: string;
        type: string;
        status: string;
        id: string;
        caseId: string;
        evidenceNumber: string | null;
    } | undefined;
    requester?: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    } | undefined;
    reviewer?: {
        id: string;
        username: string;
        fullName: string;
        role: string;
    } | null | undefined;
    status?: string | undefined;
    id?: string | undefined;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    reason?: string | undefined;
    evidenceId?: string | undefined;
    requesterId?: string | undefined;
    reviewNotes?: string | null | undefined;
    reviewedAt?: Date | null | undefined;
    reviewerId?: string | null | undefined;
    certificate?: string | null | undefined;
}>;
//# sourceMappingURL=disposal.d.ts.map