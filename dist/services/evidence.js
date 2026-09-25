/**
 * Evidence domain service — shared by the /api/v1 routes and the ledger-style
 * /api/evidence routes so both follow exactly the same flow:
 *
 *   DB write  →  build canonical metadata  →  SHA-256  →  IPFS (CID)
 *             →  ledger asset points at CID (tx ID)  →  EvidenceVersion snapshot
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import { getValidStatuses, hasPermission, normalizeStatus, isValidStatusTransition, VALID_STATUS_TRANSITIONS, } from "../utils/config.js";
import { computeSHA256 } from "../utils/hash.js";
import * as ipfs from "./ipfs.js";
import * as ledger from "./ledger.js";
import { logActivity, notifyUsers } from "./notifications.js";
// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class ServiceError extends Error {
    status;
    extra;
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}
export const EVIDENCE_TYPES = ["Physical", "Digital", "Testimonial"];
/** Statuses after which evidence can no longer be modified or transferred */
export const TERMINAL_STATUSES = ["Disposed", "Destroyed", "Released"];
export function uploadsDir() {
    return path.join(process.cwd(), "uploads");
}
export function normalizeType(type) {
    const wanted = type?.toLowerCase();
    return EVIDENCE_TYPES.find((t) => t.toLowerCase() === wanted);
}
// ---------------------------------------------------------------------------
// Human-readable IDs: EVID_2026_001, CASE_2026_001
// ---------------------------------------------------------------------------
export async function nextSequence(prefix) {
    const year = new Date().getFullYear();
    const name = `${prefix}_${year}`;
    const counter = await prisma.counter.upsert({
        where: { name },
        create: { name, value: 1 },
        update: { value: { increment: 1 } },
    });
    return `${name}_${String(counter.value).padStart(3, "0")}`;
}
// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------
export function canViewAllEvidence(role) {
    return hasPermission(role, "view_all_evidence") || hasPermission(role, "read_only_all_records");
}
/** Case IDs the user created or is assigned to as a case officer */
export async function accessibleCaseIds(userId) {
    const cases = await prisma.case.findMany({
        where: { OR: [{ createdById: userId }, { officers: { some: { userId } } }] },
        select: { id: true },
    });
    return cases.map((c) => c.id);
}
/** Prisma where-clause restricting evidence to what the user may list (null = everything) */
export async function evidenceVisibilityWhere(user) {
    if (canViewAllEvidence(user.role))
        return null;
    const caseIds = await accessibleCaseIds(user.id);
    return {
        OR: [
            { collectedById: user.id },
            { currentCustodianId: user.id },
            ...(caseIds.length > 0 ? [{ caseRefId: { in: caseIds } }] : []),
        ],
    };
}
/**
 * Build the where-clause for evidence search.
 * Filters: caseId, type, status, search (full text), officer, startDate, endDate.
 *
 * RBAC data isolation: roles with view_all_evidence see everything. Others see
 * evidence they collected, hold, or that belongs to a case they created / are
 * assigned to. Querying a specific Crime Box (caseId) is allowed — membership is
 * key-based on the client in this MVP.
 */
export async function buildEvidenceSearchWhere(query, user) {
    const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const caseId = str(query.caseId);
    const type = str(query.type);
    const status = str(query.status);
    const search = str(query.search);
    const officer = str(query.officer);
    const startDate = str(query.startDate);
    const endDate = str(query.endDate);
    const conditions = [];
    if (caseId)
        conditions.push({ caseId });
    if (type)
        conditions.push({ type: { equals: type, mode: "insensitive" } });
    if (status) {
        const canonical = normalizeStatus(status);
        if (!canonical) {
            throw new ServiceError(400, `Invalid status filter "${status}"`, { valid_statuses: getValidStatuses() });
        }
        conditions.push({ status: canonical });
    }
    if (search) {
        const term = { contains: search, mode: "insensitive" };
        conditions.push({
            OR: [{ description: term }, { caseId: term }, { evidenceNumber: term }, { location: term }],
        });
    }
    if (officer) {
        const term = { contains: officer, mode: "insensitive" };
        conditions.push({
            OR: [
                { officerName: term },
                { collectedBy: { fullName: term } },
                { collectedBy: { username: term } },
                { currentCustodian: { fullName: term } },
            ],
        });
    }
    if (startDate || endDate) {
        const range = {};
        if (startDate)
            range.gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setUTCHours(23, 59, 59, 999);
            range.lte = end;
        }
        if (Object.values(range).some((d) => Number.isNaN(d.getTime()))) {
            throw new ServiceError(400, "startDate/endDate must be valid dates (YYYY-MM-DD).");
        }
        conditions.push({ createdAt: range });
    }
    if (!caseId) {
        const visibility = await evidenceVisibilityWhere(user);
        if (visibility)
            conditions.push(visibility);
    }
    return conditions.length > 0 ? { AND: conditions } : {};
}
/** Resolve a free-form caseId (Case.id, Case.caseNumber or Crime Box caseId) to a Case row ID */
export async function resolveCaseRef(caseId) {
    const found = await prisma.case.findFirst({
        where: { OR: [{ id: caseId }, { caseNumber: caseId }] },
        select: { id: true },
    });
    if (found)
        return found.id;
    const box = await prisma.crimeBox.findUnique({ where: { caseId }, select: { caseRefId: true } });
    return box?.caseRefId ?? null;
}
/** Look up evidence by UUID, evidence number (EVID_…) or any IPFS CID it has had */
export async function findEvidenceId(ref) {
    const direct = await prisma.evidence.findFirst({
        where: { OR: [{ id: ref }, { evidenceNumber: ref }, { ipfsCid: ref }, { files: { some: { ipfsCid: ref } } }] },
        select: { id: true },
    });
    if (direct)
        return direct.id;
    const version = await prisma.evidenceVersion.findFirst({ where: { metadataCid: ref }, select: { evidenceId: true } });
    return version?.evidenceId ?? null;
}
export function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        fs.createReadStream(filePath)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")))
            .on("error", reject);
    });
}
/** Hash each uploaded file and pin it to IPFS */
export async function storeUploadedFiles(files) {
    const stored = [];
    for (const file of files) {
        const sha256Hash = await sha256File(file.path);
        let ipfsCid = null;
        try {
            ipfsCid = await ipfs.addFile(file.path, sha256Hash);
        }
        catch (err) {
            console.error(`[ipfs] Failed to add ${file.originalname}: ${err.message}`);
        }
        stored.push({
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            sha256Hash,
            ipfsCid,
            storagePath: file.filename,
        });
    }
    return stored;
}
export function removeUploadedFiles(files) {
    for (const f of files ?? []) {
        if (fs.existsSync(f.path))
            fs.unlinkSync(f.path);
    }
}
/** Read an evidence file's bytes from local storage, falling back to IPFS */
export async function readEvidenceFile(file) {
    if (file.storagePath) {
        const local = path.join(uploadsDir(), path.basename(file.storagePath));
        if (fs.existsSync(local))
            return fs.readFileSync(local);
    }
    if (file.ipfsCid)
        return ipfs.cat(file.ipfsCid);
    throw new Error("File content is not available locally or on IPFS");
}
// ---------------------------------------------------------------------------
// Canonical metadata (the document stored on IPFS and hashed onto the ledger)
// ---------------------------------------------------------------------------
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value && typeof value === "object" && !(value instanceof Date)) {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
            acc[key] = canonicalize(value[key]);
            return acc;
        }, {});
    }
    return value;
}
export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}
/**
 * Build the metadata document purely from database state, so it can be rebuilt
 * later and compared with the anchored hash to detect tampering.
 */
export async function buildMetadata(evidenceId) {
    const ev = await prisma.evidence.findUnique({
        where: { id: evidenceId },
        include: {
            collectedBy: { select: { fullName: true } },
            currentCustodian: { select: { id: true, fullName: true } },
            files: { orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] },
            custodyEvents: {
                where: { status: "approved" },
                orderBy: [{ timestamp: "asc" }, { id: "asc" }],
                include: {
                    fromUser: { select: { fullName: true } },
                    toUser: { select: { fullName: true } },
                },
            },
        },
    });
    if (!ev)
        throw new ServiceError(404, "Evidence not found.");
    const doc = {
        schema: "crime-evidence/metadata@1",
        evidenceId: ev.evidenceNumber ?? ev.id,
        systemId: ev.id,
        caseId: ev.caseId,
        description: ev.description,
        type: ev.type,
        location: ev.location,
        collectionDate: ev.collectionDate.toISOString(),
        officerName: ev.officerName ?? ev.collectedBy.fullName,
        timestamp: ev.createdAt.toISOString(),
        status: ev.status.toUpperCase(),
        fileHash: ev.fileHash,
        files: ev.files.map((f) => ({
            fileName: f.fileName,
            mimeType: f.mimeType,
            size: f.fileSize,
            sha256: f.sha256Hash,
            cid: f.ipfsCid,
        })),
        currentCustodian: { id: ev.currentCustodian.id, name: ev.currentCustodian.fullName },
        custodyChain: ev.custodyEvents.map((e) => ({
            timestamp: e.timestamp.toISOString(),
            from: e.fromUser.fullName,
            to: e.toUser.fullName,
            fromUserId: e.fromUserId,
            toUserId: e.toUserId,
            notes: e.reason,
            signature: e.signature,
        })),
    };
    const json = canonicalJson(doc);
    return { doc, json, hash: computeSHA256(Buffer.from(json, "utf-8")) };
}
// ---------------------------------------------------------------------------
// Anchoring + version history
// ---------------------------------------------------------------------------
const evidenceLocks = new Map();
/** Serialise anchoring per evidence item so version numbers never collide */
async function withEvidenceLock(evidenceId, fn) {
    const previous = evidenceLocks.get(evidenceId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    evidenceLocks.set(evidenceId, run);
    try {
        return await run;
    }
    finally {
        if (evidenceLocks.get(evidenceId) === run)
            evidenceLocks.delete(evidenceId);
    }
}
/**
 * Snapshot the evidence after a change: push metadata to IPFS, point the ledger
 * asset at the new CID and store an EvidenceVersion row.
 * Anchoring failures are recorded (anchorStatus=FAILED) rather than thrown, so the
 * business action that already happened is never lost.
 */
export async function recordEvidenceChange(evidenceId, change) {
    return withEvidenceLock(evidenceId, async () => {
        const ev = await prisma.evidence.findUnique({
            where: { id: evidenceId },
            select: { id: true, evidenceNumber: true, caseId: true, version: true, ledgerTxId: true, ipfsCid: true },
        });
        if (!ev)
            throw new ServiceError(404, "Evidence not found.");
        const { doc, json, hash } = await buildMetadata(evidenceId);
        const version = ev.version + 1;
        const assetId = ev.evidenceNumber ?? ev.id;
        let cid = null;
        let txId = null;
        let error;
        try {
            cid = await ipfs.addBuffer(Buffer.from(json, "utf-8"), `${assetId}-v${version}.json`);
            const receipt = await ledger.putAsset({
                assetId,
                caseId: ev.caseId,
                cid,
                payloadHash: hash,
                version,
                isNew: !ev.ledgerTxId,
            });
            txId = receipt.txId;
        }
        catch (err) {
            error = err.message;
            console.error(`[anchor] ${assetId} v${version} failed: ${err.message}`);
        }
        const anchorStatus = error ? "FAILED" : "ANCHORED";
        await prisma.$transaction([
            prisma.evidenceVersion.create({
                data: {
                    evidenceId,
                    version,
                    action: change.action,
                    changedById: change.actor?.id ?? null,
                    changedByName: change.actor?.username ?? "system",
                    notes: change.notes ?? null,
                    snapshot: doc,
                    metadataHash: hash,
                    metadataCid: cid,
                    ledgerTxId: txId,
                },
            }),
            prisma.evidence.update({
                where: { id: evidenceId },
                data: {
                    version,
                    metadataHash: hash,
                    anchorStatus,
                    ...(cid && { ipfsCid: cid }),
                    ...(txId && { ledgerTxId: txId }),
                },
            }),
        ]);
        return { version, metadataHash: hash, cid, txId, anchorStatus, ...(error && { error }) };
    });
}
export async function verifyEvidence(evidenceId) {
    const ev = await prisma.evidence.findUnique({
        where: { id: evidenceId },
        include: { files: { orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] } },
    });
    if (!ev)
        throw new ServiceError(404, "Evidence not found.");
    const checks = [];
    for (const file of ev.files) {
        try {
            const actual = computeSHA256(await readEvidenceFile(file));
            checks.push({ name: `file:${file.fileName}`, passed: actual === file.sha256Hash, expected: file.sha256Hash, actual });
        }
        catch (err) {
            checks.push({ name: `file:${file.fileName}`, passed: false, expected: file.sha256Hash, actual: null, detail: err.message });
        }
    }
    if (ev.fileHash) {
        checks.push({
            name: "primary_file_hash",
            passed: ev.files.some((f) => f.sha256Hash === ev.fileHash),
            expected: ev.fileHash,
            actual: ev.files[0]?.sha256Hash ?? null,
        });
    }
    if (!ev.metadataHash) {
        checks.push({ name: "metadata_hash", passed: null, detail: "Evidence has never been anchored." });
    }
    else {
        const rebuilt = await buildMetadata(evidenceId);
        checks.push({ name: "metadata_hash", passed: rebuilt.hash === ev.metadataHash, expected: ev.metadataHash, actual: rebuilt.hash });
    }
    const assetId = ev.evidenceNumber ?? ev.id;
    if (ev.anchorStatus !== "ANCHORED") {
        checks.push({ name: "ledger_pointer", passed: null, detail: `Latest change is not anchored (anchorStatus=${ev.anchorStatus}).` });
    }
    else {
        try {
            const asset = await ledger.readAsset(assetId);
            if (!asset) {
                checks.push({ name: "ledger_pointer", passed: false, expected: ev.ipfsCid, actual: null, detail: "Asset not found on ledger." });
            }
            else {
                const hashMatches = asset.payloadHash === null || asset.payloadHash === ev.metadataHash;
                checks.push({ name: "ledger_pointer", passed: asset.cid === ev.ipfsCid && hashMatches, expected: ev.ipfsCid, actual: asset.cid });
            }
        }
        catch (err) {
            checks.push({ name: "ledger_pointer", passed: null, detail: `Ledger unreachable: ${err.message}` });
        }
        const chain = await ledger.verifyAssetChain(assetId);
        checks.push({
            name: "ledger_chain",
            passed: chain.valid,
            detail: chain.valid ? `${chain.blocksChecked} block(s) verified` : `Hash chain broken at block ${chain.brokenAt}`,
        });
    }
    if (ev.ipfsCid) {
        try {
            const actual = computeSHA256(await ipfs.cat(ev.ipfsCid));
            checks.push({ name: "ipfs_metadata", passed: actual === ev.metadataHash, expected: ev.metadataHash, actual });
        }
        catch (err) {
            checks.push({ name: "ipfs_metadata", passed: null, detail: `IPFS_FETCH_FAILED: ${err.message}` });
        }
    }
    const status = checks.some((c) => c.passed === false)
        ? "TAMPERED"
        : checks.some((c) => c.passed === null)
            ? "UNVERIFIABLE"
            : "VERIFIED";
    return {
        status,
        verified: status === "VERIFIED",
        evidenceId: ev.id,
        evidenceNumber: ev.evidenceNumber,
        metadataHash: ev.metadataHash,
        fileHash: ev.fileHash,
        ipfsCid: ev.ipfsCid,
        ledgerTxId: ev.ledgerTxId,
        ledgerMode: ledger.getLedgerMode(),
        ipfsMode: ipfs.getIpfsMode(),
        checkedAt: new Date().toISOString(),
        checks,
    };
}
export async function createEvidence(input, actor, files = []) {
    const caseId = typeof input.caseId === "string" ? input.caseId.trim() : "";
    const { description, collectionDate, location } = input;
    if (!caseId || !input.type || !description || !collectionDate || !location) {
        throw new ServiceError(400, "Missing required fields", {
            required: ["caseId", "type", "description", "collectionDate", "location"],
        });
    }
    const type = normalizeType(input.type);
    if (!type) {
        throw new ServiceError(400, `Invalid evidence type "${input.type}"`, { valid_types: EVIDENCE_TYPES });
    }
    const status = normalizeStatus(input.status ?? getValidStatuses()[0]);
    if (!status || TERMINAL_STATUSES.includes(status)) {
        throw new ServiceError(400, `Invalid status "${input.status}".`, { valid_statuses: getValidStatuses() });
    }
    const collected = new Date(collectionDate);
    if (Number.isNaN(collected.getTime())) {
        throw new ServiceError(400, `Invalid collectionDate "${collectionDate}"`);
    }
    let evidenceNumber = input.evidenceNumber?.trim();
    if (evidenceNumber) {
        if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(evidenceNumber)) {
            throw new ServiceError(400, "evidenceId may only contain letters, digits, '_', '-' and '.' (max 64 chars).");
        }
        const clash = await prisma.evidence.findUnique({ where: { evidenceNumber } });
        if (clash)
            throw new ServiceError(409, `Evidence "${evidenceNumber}" already exists.`);
    }
    else {
        evidenceNumber = await nextSequence("EVID");
    }
    let tags = null;
    if (input.tags !== undefined && input.tags !== null && input.tags !== "") {
        tags = typeof input.tags === "string" ? input.tags : JSON.stringify(input.tags);
    }
    const caseRefId = await resolveCaseRef(caseId);
    const evidence = await prisma.evidence.create({
        data: {
            evidenceNumber,
            caseId,
            caseRefId,
            type,
            description,
            collectionDate: collected,
            location,
            tags,
            status,
            officerNotes: input.officerNotes ?? null,
            officerName: input.officerName ?? null,
            fileHash: files[0]?.sha256Hash ?? null,
            collectedById: actor.id,
            currentCustodianId: actor.id,
            files: { create: files },
        },
    });
    await prisma.accessLog.create({
        data: { evidenceId: evidence.id, userId: actor.id, action: "register", result: "success" },
    });
    await logActivity(actor, "registered_evidence", "Evidence", evidence.id, evidenceNumber);
    const anchoring = await recordEvidenceChange(evidence.id, { action: "REGISTERED", actor });
    return { evidence: await getEvidenceDetail(evidence.id), anchoring };
}
export async function getEvidenceDetail(evidenceId) {
    return prisma.evidence.findUnique({
        where: { id: evidenceId },
        include: {
            collectedBy: { select: { id: true, username: true, fullName: true, role: true, department: true } },
            currentCustodian: { select: { id: true, username: true, fullName: true, role: true, department: true } },
            files: { orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] },
            custodyEvents: {
                orderBy: { timestamp: "asc" },
                include: {
                    fromUser: { select: { id: true, username: true, fullName: true } },
                    toUser: { select: { id: true, username: true, fullName: true } },
                },
            },
        },
    });
}
export async function updateEvidence(evidenceId, patch, actor, notes) {
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence)
        throw new ServiceError(404, "Evidence not found.");
    if (evidence.locked) {
        throw new ServiceError(409, "Evidence is locked due to a pending custody transfer.", {
            hint: "Resolve the pending transfer before modifying evidence.",
        });
    }
    if (TERMINAL_STATUSES.includes(evidence.status)) {
        throw new ServiceError(409, `Evidence is ${evidence.status} and can no longer be modified.`);
    }
    let status;
    if (patch.status !== undefined) {
        status = normalizeStatus(patch.status);
        if (!status) {
            throw new ServiceError(400, `Invalid status "${patch.status}"`, { valid_statuses: getValidStatuses() });
        }
        if (status === "Disposed") {
            throw new ServiceError(400, "Evidence can only be disposed through a JUDGE-approved disposal request.");
        }
        if (status !== evidence.status && !isValidStatusTransition(evidence.status, status)) {
            throw new ServiceError(400, `Invalid status transition from "${evidence.status}" to "${status}"`, {
                current_status: evidence.status,
                valid_transitions: VALID_STATUS_TRANSITIONS[evidence.status] || [],
            });
        }
    }
    const caseId = patch.caseId?.trim();
    const statusChanged = status !== undefined && status !== evidence.status;
    const updated = await prisma.evidence.update({
        where: { id: evidenceId },
        data: {
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.tags !== undefined && { tags: typeof patch.tags === "string" ? patch.tags : JSON.stringify(patch.tags) }),
            ...(status !== undefined && { status }),
            ...(patch.officerNotes !== undefined && { officerNotes: patch.officerNotes }),
            ...(patch.location !== undefined && { location: patch.location }),
            ...(patch.officerName !== undefined && { officerName: patch.officerName }),
            ...(caseId && { caseId, caseRefId: await resolveCaseRef(caseId) }),
        },
    });
    await prisma.accessLog.create({
        data: { evidenceId, userId: actor.id, action: "modify", result: "success" },
    });
    await logActivity(actor, statusChanged ? "changed_evidence_status" : "updated_evidence", "Evidence", evidenceId, statusChanged ? `${evidence.status} → ${status}` : evidence.evidenceNumber);
    const anchoring = await recordEvidenceChange(evidenceId, {
        action: statusChanged ? `STATUS_CHANGED:${status.toUpperCase()}` : "UPDATED",
        actor,
        notes: notes ?? null,
    });
    return { evidence: updated, anchoring };
}
// ---------------------------------------------------------------------------
// Custody transfer (initiate)
// ---------------------------------------------------------------------------
/** Find an active user by ID, username, email or full name (case-insensitive) */
export async function resolveUser(ref) {
    const value = ref?.trim();
    if (!value)
        return null;
    return prisma.user.findFirst({
        where: {
            OR: [
                { id: value },
                { username: { equals: value, mode: "insensitive" } },
                { email: { equals: value, mode: "insensitive" } },
                { fullName: { equals: value, mode: "insensitive" } },
            ],
        },
    });
}
export async function initiateTransfer(evidenceId, toUserRef, reason, actor) {
    if (!toUserRef || !reason?.trim()) {
        throw new ServiceError(400, "Missing required fields", { required: ["toUserId", "reason"] });
    }
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence)
        throw new ServiceError(404, "Evidence not found.");
    if (TERMINAL_STATUSES.includes(evidence.status)) {
        throw new ServiceError(409, `Evidence is ${evidence.status} and cannot be transferred.`);
    }
    // LOCKING CHECK: prevent double-transfers
    if (evidence.locked) {
        throw new ServiceError(409, "Evidence is locked due to a pending custody transfer.", {
            hint: "The current pending transfer must be approved or rejected first.",
        });
    }
    if (evidence.currentCustodianId !== actor.id) {
        throw new ServiceError(403, "Only the current custodian can transfer this evidence.");
    }
    const recipient = await resolveUser(toUserRef);
    if (!recipient || !recipient.isActive) {
        throw new ServiceError(404, "Recipient user not found or inactive.");
    }
    if (recipient.id === actor.id) {
        throw new ServiceError(400, "You already hold custody of this evidence.");
    }
    const [, custodyEvent] = await prisma.$transaction([
        prisma.evidence.update({ where: { id: evidence.id }, data: { locked: true } }),
        prisma.custodyEvent.create({
            data: {
                evidenceId: evidence.id,
                fromUserId: actor.id,
                toUserId: recipient.id,
                eventType: "transfer",
                reason: reason.trim(),
                status: "pending",
            },
        }),
    ]);
    await prisma.accessLog.create({
        data: { evidenceId: evidence.id, userId: actor.id, action: "transfer", result: "success" },
    });
    await logActivity(actor, "requested_transfer", "Evidence", evidence.id, `${evidence.evidenceNumber} → ${recipient.username}`);
    await notifyUsers([recipient.id], {
        type: "transfer_request",
        title: "Custody Transfer Request",
        message: `${actor.username} wants to transfer ${evidence.evidenceNumber ?? "evidence"} to you: ${reason.trim()}`,
        evidenceId: evidence.id,
    });
    const anchoring = await recordEvidenceChange(evidence.id, {
        action: "TRANSFER_REQUESTED",
        actor,
        notes: `To ${recipient.username}: ${reason.trim()}`,
    });
    return { custodyEvent, recipient, anchoring };
}
// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
/**
 * Remove evidence from the working database. The ledger keeps the full
 * transaction history (a DeleteAsset transaction is appended).
 */
export async function deleteEvidence(evidenceId) {
    const ev = await prisma.evidence.findUnique({ where: { id: evidenceId }, select: { id: true, evidenceNumber: true } });
    if (!ev)
        throw new ServiceError(404, "Evidence not found.");
    let ledgerTxId = null;
    let ledgerError;
    try {
        ledgerTxId = (await ledger.deleteAsset(ev.evidenceNumber ?? ev.id)).txId;
    }
    catch (err) {
        ledgerError = err.message;
    }
    await prisma.$transaction([
        prisma.accessLog.deleteMany({ where: { evidenceId } }),
        prisma.custodyEvent.deleteMany({ where: { evidenceId } }),
        prisma.evidenceFile.deleteMany({ where: { evidenceId } }),
        prisma.evidenceComment.deleteMany({ where: { evidenceId } }),
        prisma.evidenceAccessRequest.deleteMany({ where: { evidenceId } }),
        prisma.labResult.deleteMany({ where: { evidenceId } }),
        prisma.destructionRequest.deleteMany({ where: { evidenceId } }),
        prisma.evidenceVersion.deleteMany({ where: { evidenceId } }),
        prisma.evidence.delete({ where: { id: evidenceId } }),
    ]);
    return { evidenceId: ev.id, evidenceNumber: ev.evidenceNumber, ledgerTxId, ...(ledgerError && { ledgerError }) };
}
//# sourceMappingURL=evidence.js.map