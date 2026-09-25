/**
 * Evidence domain service — shared by the /api/v1 routes and the ledger-style
 * /api/evidence routes so both follow exactly the same flow:
 *
 *   DB write  →  build canonical metadata  →  SHA-256  →  IPFS (CID)
 *             →  ledger asset points at CID (tx ID)  →  EvidenceVersion snapshot
 */
import * as ipfs from "./ipfs.js";
import * as ledger from "./ledger.js";
export declare class ServiceError extends Error {
    status: number;
    extra: Record<string, unknown>;
    constructor(status: number, message: string, extra?: Record<string, unknown>);
}
export interface Actor {
    id: string;
    username: string;
    role: string;
}
export declare const EVIDENCE_TYPES: string[];
/** Statuses after which evidence can no longer be modified or transferred */
export declare const TERMINAL_STATUSES: string[];
export declare function uploadsDir(): string;
export declare function normalizeType(type: string): string | undefined;
export declare function nextSequence(prefix: string): Promise<string>;
export declare function canViewAllEvidence(role: string): boolean;
/** Case IDs the user created or is assigned to as a case officer */
export declare function accessibleCaseIds(userId: string): Promise<string[]>;
/** Prisma where-clause restricting evidence to what the user may list (null = everything) */
export declare function evidenceVisibilityWhere(user: Actor): Promise<Record<string, unknown> | null>;
/**
 * Build the where-clause for evidence search.
 * Filters: caseId, type, status, search (full text), officer, startDate, endDate.
 *
 * RBAC data isolation: roles with view_all_evidence see everything. Others see
 * evidence they collected, hold, or that belongs to a case they created / are
 * assigned to. Querying a specific Crime Box (caseId) is allowed — membership is
 * key-based on the client in this MVP.
 */
export declare function buildEvidenceSearchWhere(query: Record<string, unknown>, user: Actor): Promise<Record<string, unknown>>;
/** Resolve a free-form caseId (Case.id, Case.caseNumber or Crime Box caseId) to a Case row ID */
export declare function resolveCaseRef(caseId: string): Promise<string | null>;
/** Look up evidence by UUID, evidence number (EVID_…) or any IPFS CID it has had */
export declare function findEvidenceId(ref: string): Promise<string | null>;
export interface UploadedFile {
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
    filename: string;
}
export interface StoredFile {
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256Hash: string;
    ipfsCid: string | null;
    storagePath: string;
}
export declare function sha256File(filePath: string): Promise<string>;
/** Hash each uploaded file and pin it to IPFS */
export declare function storeUploadedFiles(files: UploadedFile[]): Promise<StoredFile[]>;
export declare function removeUploadedFiles(files: UploadedFile[] | undefined): void;
/** Read an evidence file's bytes from local storage, falling back to IPFS */
export declare function readEvidenceFile(file: {
    storagePath: string | null;
    ipfsCid: string | null;
}): Promise<Buffer>;
export declare function canonicalJson(value: unknown): string;
/**
 * Build the metadata document purely from database state, so it can be rebuilt
 * later and compared with the anchored hash to detect tampering.
 */
export declare function buildMetadata(evidenceId: string): Promise<{
    doc: {
        schema: string;
        evidenceId: string;
        systemId: string;
        caseId: string;
        description: string;
        type: string;
        location: string;
        collectionDate: string;
        officerName: string;
        timestamp: string;
        status: string;
        fileHash: string | null;
        files: {
            fileName: string;
            mimeType: string;
            size: number;
            sha256: string;
            cid: string | null;
        }[];
        currentCustodian: {
            id: string;
            name: string;
        };
        custodyChain: {
            timestamp: string;
            from: string;
            to: string;
            fromUserId: string;
            toUserId: string;
            notes: string;
            signature: string | null;
        }[];
    };
    json: string;
    hash: string;
}>;
export interface AnchorResult {
    version: number;
    metadataHash: string;
    cid: string | null;
    txId: string | null;
    anchorStatus: "ANCHORED" | "FAILED";
    error?: string;
}
/**
 * Snapshot the evidence after a change: push metadata to IPFS, point the ledger
 * asset at the new CID and store an EvidenceVersion row.
 * Anchoring failures are recorded (anchorStatus=FAILED) rather than thrown, so the
 * business action that already happened is never lost.
 */
export declare function recordEvidenceChange(evidenceId: string, change: {
    action: string;
    actor: {
        id: string;
        username: string;
    } | null;
    notes?: string | null;
}): Promise<AnchorResult>;
export interface IntegrityCheck {
    name: string;
    passed: boolean | null;
    expected?: string | null;
    actual?: string | null;
    detail?: string;
}
export declare function verifyEvidence(evidenceId: string): Promise<{
    status: string;
    verified: boolean;
    evidenceId: string;
    evidenceNumber: string | null;
    metadataHash: string | null;
    fileHash: string | null;
    ipfsCid: string | null;
    ledgerTxId: string | null;
    ledgerMode: ledger.LedgerMode;
    ipfsMode: ipfs.IpfsMode;
    checkedAt: string;
    checks: IntegrityCheck[];
}>;
export interface CreateEvidenceInput {
    evidenceNumber?: string;
    caseId?: string;
    type?: string;
    description?: string;
    collectionDate?: string | Date;
    location?: string;
    tags?: unknown;
    status?: string;
    officerNotes?: string | null;
    officerName?: string | null;
}
export declare function createEvidence(input: CreateEvidenceInput, actor: Actor, files?: StoredFile[]): Promise<{
    evidence: ({
        currentCustodian: {
            id: string;
            username: string;
            fullName: string;
            department: string | null;
            role: string;
        };
        collectedBy: {
            id: string;
            username: string;
            fullName: string;
            department: string | null;
            role: string;
        };
        custodyEvents: ({
            toUser: {
                id: string;
                username: string;
                fullName: string;
            };
            fromUser: {
                id: string;
                username: string;
                fullName: string;
            };
        } & {
            status: string;
            id: string;
            reason: string;
            evidenceId: string;
            timestamp: Date;
            eventType: string;
            signature: string | null;
            fromUserId: string;
            toUserId: string;
        })[];
        files: {
            mimeType: string;
            id: string;
            ipfsCid: string | null;
            evidenceId: string;
            uploadedAt: Date;
            fileName: string;
            fileSize: number;
            sha256Hash: string;
            storagePath: string | null;
        }[];
    } & {
        version: number;
        description: string;
        type: string;
        status: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        caseId: string;
        caseRefId: string | null;
        currentCustodianId: string;
        collectedById: string;
        location: string;
        evidenceNumber: string | null;
        officerName: string | null;
        collectionDate: Date;
        tags: string | null;
        fileHash: string | null;
        metadataHash: string | null;
        ipfsCid: string | null;
        ledgerTxId: string | null;
        anchorStatus: string;
        locked: boolean;
        officerNotes: string | null;
        retentionDeadline: Date | null;
        retentionPolicy: string | null;
        allowedRoles: string | null;
    }) | null;
    anchoring: AnchorResult;
}>;
export declare function getEvidenceDetail(evidenceId: string): Promise<({
    currentCustodian: {
        id: string;
        username: string;
        fullName: string;
        department: string | null;
        role: string;
    };
    collectedBy: {
        id: string;
        username: string;
        fullName: string;
        department: string | null;
        role: string;
    };
    custodyEvents: ({
        toUser: {
            id: string;
            username: string;
            fullName: string;
        };
        fromUser: {
            id: string;
            username: string;
            fullName: string;
        };
    } & {
        status: string;
        id: string;
        reason: string;
        evidenceId: string;
        timestamp: Date;
        eventType: string;
        signature: string | null;
        fromUserId: string;
        toUserId: string;
    })[];
    files: {
        mimeType: string;
        id: string;
        ipfsCid: string | null;
        evidenceId: string;
        uploadedAt: Date;
        fileName: string;
        fileSize: number;
        sha256Hash: string;
        storagePath: string | null;
    }[];
} & {
    version: number;
    description: string;
    type: string;
    status: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    caseId: string;
    caseRefId: string | null;
    currentCustodianId: string;
    collectedById: string;
    location: string;
    evidenceNumber: string | null;
    officerName: string | null;
    collectionDate: Date;
    tags: string | null;
    fileHash: string | null;
    metadataHash: string | null;
    ipfsCid: string | null;
    ledgerTxId: string | null;
    anchorStatus: string;
    locked: boolean;
    officerNotes: string | null;
    retentionDeadline: Date | null;
    retentionPolicy: string | null;
    allowedRoles: string | null;
}) | null>;
export interface UpdateEvidenceInput {
    description?: string;
    tags?: unknown;
    status?: string;
    officerNotes?: string | null;
    location?: string;
    caseId?: string;
    officerName?: string | null;
}
export declare function updateEvidence(evidenceId: string, patch: UpdateEvidenceInput, actor: Actor, notes?: string | null): Promise<{
    evidence: {
        version: number;
        description: string;
        type: string;
        status: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        caseId: string;
        caseRefId: string | null;
        currentCustodianId: string;
        collectedById: string;
        location: string;
        evidenceNumber: string | null;
        officerName: string | null;
        collectionDate: Date;
        tags: string | null;
        fileHash: string | null;
        metadataHash: string | null;
        ipfsCid: string | null;
        ledgerTxId: string | null;
        anchorStatus: string;
        locked: boolean;
        officerNotes: string | null;
        retentionDeadline: Date | null;
        retentionPolicy: string | null;
        allowedRoles: string | null;
    };
    anchoring: AnchorResult;
}>;
/** Find an active user by ID, username, email or full name (case-insensitive) */
export declare function resolveUser(ref: string): Promise<{
    email: string;
    id: string;
    username: string;
    fullName: string;
    badgeNumber: string | null;
    department: string | null;
    role: string;
    passwordHash: string;
    mfaEnabled: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
} | null>;
export declare function initiateTransfer(evidenceId: string, toUserRef: string, reason: string, actor: Actor): Promise<{
    custodyEvent: {
        status: string;
        id: string;
        reason: string;
        evidenceId: string;
        timestamp: Date;
        eventType: string;
        signature: string | null;
        fromUserId: string;
        toUserId: string;
    };
    recipient: {
        email: string;
        id: string;
        username: string;
        fullName: string;
        badgeNumber: string | null;
        department: string | null;
        role: string;
        passwordHash: string;
        mfaEnabled: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    };
    anchoring: AnchorResult;
}>;
/**
 * Remove evidence from the working database. The ledger keeps the full
 * transaction history (a DeleteAsset transaction is appended).
 */
export declare function deleteEvidence(evidenceId: string): Promise<{
    ledgerError?: string | undefined;
    evidenceId: string;
    evidenceNumber: string | null;
    ledgerTxId: string | null;
}>;
//# sourceMappingURL=evidence.d.ts.map