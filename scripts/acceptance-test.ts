/**
 * End-to-end acceptance test for the backend.
 *
 * Walks through the "Setup" checklist (steps 1–28) and the ledger-style
 * /api/evidence endpoints against a running API, then checks tamper detection.
 *
 * Prerequisites: API running (npm run dev:api), demo users seeded (npm run db:seed).
 * Usage: npm run test:acceptance        (API_URL defaults to http://localhost:3001)
 */
import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

const API = (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
let failures = 0;
let step = 0;

function check(label: string, ok: boolean, detail?: unknown) {
    step++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${String(step).padStart(2)}. ${label}${!ok && detail !== undefined ? `\n        → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures++;
}

async function call(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, headers: res.headers };
}

async function login(username: string, password: string) {
    const r = await call("POST", "/api/v1/auth/login", undefined, { username, password });
    if (r.status !== 200) throw new Error(`Login failed for ${username}: ${JSON.stringify(r.data)}`);
    return { token: r.data.token as string, id: r.data.user.id as string };
}

async function main() {
    console.log(`Acceptance test against ${API}\n`);
    const prosecutor = await login("prosecutor", "prosecutor123");
    const collector = await login("collector", "collector123");
    const analyst = await login("analyst", "analyst123");
    const judge = await login("judge", "judge123");
    const auditor = await login("auditor", "auditor123");
    const admin = await login("admin", "admin123");

    // ---------------- Setup ----------------
    const newCase = await call("POST", "/api/v1/cases", prosecutor.token, { title: `Acceptance case ${Date.now()}`, description: "E2E" });
    check("PROSECUTOR creates a case and gets a case number", newCase.status === 201 && /^CASE_\d{4}_\d{3,}$/.test(newCase.data.caseNumber), newCase.data);
    const caseId = newCase.data.id as string;

    const me = await call("GET", "/api/auth/me", collector.token);
    check("GET /api/auth/me returns the user's UUID", me.status === 200 && me.data.user.id === collector.id, me.data);

    const addC = await call("POST", `/api/v1/cases/${caseId}/officers`, prosecutor.token, { userId: collector.id });
    const addA = await call("POST", `/api/v1/cases/${caseId}/officers`, prosecutor.token, { userId: "analyst" });
    check("PROSECUTOR adds COLLECTOR and FORENSIC_ANALYST as case officers", addC.status === 201 && addA.status === 201, [addC.data, addA.data]);

    // ---------------- COLLECTOR ----------------
    const fileBytes = crypto.randomBytes(2048);
    const fileHash = crypto.createHash("sha256").update(fileBytes).digest("hex");
    const form = new FormData();
    form.append("caseId", newCase.data.caseNumber);
    form.append("type", "DIGITAL");
    form.append("description", "CCTV export from the bank lobby");
    form.append("collectionDate", new Date().toISOString());
    form.append("location", "Bank lobby");
    form.append("files", new Blob([fileBytes], { type: "application/octet-stream" }), "cctv.bin");
    const created = await call("POST", "/api/v1/evidence", collector.token, form);
    const evidenceId = created.data?.evidence?.id as string;
    check("COLLECTOR logs a DIGITAL item with a real file, attached to the case", created.status === 201 && created.data.evidence.caseRefId === caseId, created.data);

    const detail = await call("GET", `/api/v1/evidence/${evidenceId}`, collector.token);
    check("Detail shows Metadata SHA-256 and File SHA-256",
        /^[0-9a-f]{64}$/.test(detail.data.evidence.metadataHash ?? "") && detail.data.evidence.fileHash === fileHash, detail.data.evidence);

    const verify = await call("POST", `/api/v1/evidence/${evidenceId}/verify`, collector.token, {});
    check("Verify Integrity → VERIFIED", verify.data?.integrity?.status === "VERIFIED", verify.data);

    const download = await call("GET", `/api/v1/evidence/${evidenceId}/download`, collector.token);
    check("Download File returns the original bytes", download.status === 200 && Buffer.isBuffer(download.data) && download.data.equals(fileBytes), download.status);

    const report = await call("GET", `/api/v1/evidence/${evidenceId}/report`, collector.token);
    const pdfText = Buffer.isBuffer(report.data) ? report.data.toString("latin1") : "";
    check("Generate Report downloads a PDF", report.status === 200 && pdfText.startsWith("%PDF") && (report.headers.get("content-type") ?? "").includes("pdf"), report.status);

    const transfer1 = await call("POST", `/api/v1/custody/evidence/${evidenceId}/transfer`, collector.token, { toUserId: analyst.id, reason: "For forensic analysis" });
    check("COLLECTOR requests transfer to FORENSIC_ANALYST", transfer1.status === 201, transfer1.data);

    // ---------------- FORENSIC_ANALYST ----------------
    const pendingA = await call("GET", "/api/v1/custody/pending", analyst.token);
    const incoming = pendingA.data.incoming?.find((t: any) => t.evidence.id === evidenceId);
    const accept = await call("POST", `/api/v1/custody/transfer/${incoming?.id}/approve`, analyst.token, { signature: "analyst-signature" });
    const afterAccept = await call("GET", `/api/v1/evidence/${evidenceId}`, analyst.token);
    check("FORENSIC_ANALYST accepts; current custodian updated", accept.status === 200 && afterAccept.data.evidence.currentCustodianId === analyst.id, accept.data);

    const transfer2 = await call("POST", `/api/v1/custody/evidence/${evidenceId}/transfer`, analyst.token, { toUserId: "collector", reason: "Analysis complete" });
    check("FORENSIC_ANALYST initiates transfer back to COLLECTOR", transfer2.status === 201, transfer2.data);

    const pendingC = await call("GET", "/api/v1/custody/pending", collector.token);
    const back = pendingC.data.incoming?.find((t: any) => t.evidence.id === evidenceId);
    const reject = await call("POST", `/api/v1/custody/transfer/${back?.id}/reject`, collector.token, { reason: "Keep it in the lab for now" });
    const afterReject = await call("GET", `/api/v1/evidence/${evidenceId}`, collector.token);
    check("COLLECTOR rejects with a note; custody did not move",
        reject.status === 200 && afterReject.data.evidence.currentCustodianId === analyst.id && afterReject.data.evidence.locked === false, reject.data);

    // ---------------- PROSECUTOR / JUDGE: disposal ----------------
    const disposal = await call("POST", `/api/v1/evidence/${evidenceId}/disposal-requests`, prosecutor.token, { reason: "Case closed; retention period over" });
    check("PROSECUTOR requests disposal with a reason", disposal.status === 201 && disposal.data.status === "pending", disposal.data);

    const selfApprove = await call("PUT", `/api/v1/evidence/${evidenceId}/disposal-requests/${disposal.data.id}`, prosecutor.token, { status: "approved", reviewNotes: "self" });
    check("PROSECUTOR approving it themselves → 403", selfApprove.status === 403, selfApprove.data);

    const queue = await call("GET", "/api/v1/disposals?status=pending", judge.token);
    const found = queue.data.requests?.some((r: any) => r.id === disposal.data.id);
    const noNote = await call("POST", `/api/v1/disposals/${disposal.data.id}/approve`, judge.token, {});
    const approve = await call("POST", `/api/v1/disposals/${disposal.data.id}/approve`, judge.token, { note: "Approved per court order 42" });
    const afterDispose = await call("GET", `/api/v1/evidence/${evidenceId}`, judge.token);
    check("JUDGE finds the pending disposal, note is mandatory, approval → DISPOSED",
        found && noNote.status === 400 && approve.status === 200 && afterDispose.data.evidence.status === "Disposed", { noNote: noNote.data, approve: approve.data });

    // Second item for the reject path
    const form2 = new FormData();
    form2.append("caseId", caseId);
    form2.append("type", "Physical");
    form2.append("description", "Crowbar");
    form2.append("collectionDate", new Date().toISOString());
    form2.append("location", "Alley");
    const item2 = await call("POST", "/api/v1/evidence", collector.token, form2);
    const d2 = await call("POST", `/api/v1/evidence/${item2.data.evidence.id}/disposal-requests`, prosecutor.token, { reason: "Duplicate item" });
    const rej = await call("POST", `/api/v1/disposals/${d2.data.id}/reject`, judge.token, { note: "Still needed for trial" });
    const after2 = await call("GET", `/api/v1/evidence/${item2.data.evidence.id}`, judge.token);
    check("JUDGE rejects a disposal on a different item; status unchanged", rej.status === 200 && rej.data.status === "rejected" && after2.data.evidence.status === "Collected", rej.data);

    // ---------------- Version history ----------------
    const versions = await call("GET", `/api/v1/evidence/${evidenceId}/versions`, collector.token);
    const actions = (versions.data.versions ?? []).map((v: any) => v.action);
    check("Version History lists every version with who/when",
        ["REGISTERED", "TRANSFER_REQUESTED", "TRANSFER_ACCEPTED", "TRANSFER_REJECTED", "DISPOSED"].every((a) => actions.includes(a))
        && versions.data.versions.every((v: any) => v.changedByName && v.createdAt && v.ledgerTxId), actions);

    // ---------------- Case management ----------------
    const edit = await call("PUT", `/api/v1/cases/${caseId}`, prosecutor.token, { title: "Bank robbery (edited)", status: "active" });
    check("PROSECUTOR edits case title/status", edit.status === 200 && edit.data.title === "Bank robbery (edited)" && edit.data.status === "active", edit.data);

    const remove = await call("DELETE", `/api/v1/cases/${caseId}/officers/${analyst.id}`, prosecutor.token);
    const officers = await call("GET", `/api/v1/cases/${caseId}/officers`, prosecutor.token);
    check("PROSECUTOR removes FORENSIC_ANALYST; removal reflected",
        remove.status === 200 && !officers.data.officers.some((o: any) => o.userId === analyst.id), officers.data);

    // ---------------- Dashboard / activity / notifications ----------------
    const stats = await call("GET", "/api/v1/stats", collector.token);
    check("COLLECTOR dashboard shows real counts", stats.status === 200 && stats.data.totalEvidence >= 1 && stats.data.totalCases >= 1, stats.data);

    const activity = await call("GET", "/api/v1/activity?mine=true", collector.token);
    check("Activity feed contains the COLLECTOR's own actions",
        activity.data.logs?.some((l: any) => l.action === "registered_evidence") && activity.data.logs?.some((l: any) => l.action === "rejected_transfer"), activity.data.logs?.map((l: any) => l.action));

    const notes = await call("GET", "/api/v1/notifications", collector.token);
    const types = (notes.data.notifications ?? []).map((n: any) => n.type);
    check("COLLECTOR notifications include transfer-accepted and disposal outcome",
        types.includes("transfer_accepted") && types.includes("disposal_decision"), types);

    await call("PUT", "/api/v1/notifications/read-all", collector.token);
    const notes2 = await call("GET", "/api/v1/notifications", collector.token);
    check("Mark notifications read → unread count drops", notes.data.unreadCount > 0 && notes2.data.unreadCount === 0, [notes.data.unreadCount, notes2.data.unreadCount]);

    // ---------------- AUDITOR ----------------
    const aEvidence = await call("GET", "/api/v1/evidence", auditor.token);
    const aCases = await call("GET", "/api/v1/cases", auditor.token);
    const aRegister = await call("POST", "/api/v1/evidence", auditor.token, { caseId, type: "Physical", description: "x", collectionDate: new Date().toISOString(), location: "x" });
    const aTransfer = await call("POST", `/api/v1/custody/evidence/${item2.data.evidence.id}/transfer`, auditor.token, { toUserId: "collector", reason: "x" });
    const aApprove = await call("POST", `/api/v1/disposals/${d2.data.id}/approve`, auditor.token, { note: "x" });
    check("AUDITOR can view evidence/cases but register/transfer/approve are 403",
        aEvidence.status === 200 && aCases.status === 200 && [aRegister.status, aTransfer.status, aApprove.status].every((s) => s === 403),
        [aEvidence.status, aCases.status, aRegister.status, aTransfer.status, aApprove.status]);

    const aLog = await call("GET", "/api/v1/audit-log?limit=200", auditor.token);
    const logActions = (aLog.data.logs ?? []).map((l: any) => `${l.username}:${l.action}`);
    check("Audit Log shows the auditor's login and other roles' actions",
        aLog.status === 200 && logActions.includes("auditor:LOGIN") && logActions.some((a: string) => a.startsWith("prosecutor:POST")), logActions.slice(0, 10));

    // ---------------- ADMIN ----------------
    const adminLog = await call("GET", "/api/v1/audit-log", admin.token);
    check("ADMIN audit log loads", adminLog.status === 200, adminLog.data);

    const deniedLog = await call("GET", "/api/audit-log", collector.token);
    check("Non-ADMIN (collector) audit log → 403", deniedLog.status === 403, deniedLog.data);

    // ---------------- Logout / session ----------------
    const session = await login("collector", "collector123");
    const before = await call("GET", "/api/v1/auth/me", session.token);
    const logout = await call("POST", "/api/v1/auth/logout", session.token);
    const reuse = await call("GET", "/api/v1/evidence", session.token);
    check("Sign Out then reuse the captured token → 401", before.status === 200 && logout.status === 200 && reuse.status === 401, reuse.data);

    // ---------------- Ledger-style API (/api/evidence) ----------------
    const evidNo = `EVID_TEST_${Date.now()}`;
    const lCreate = await call("POST", "/api/evidence", collector.token, {
        evidenceId: evidNo, caseId: "CASE_99", description: "Digital camera found at crime scene", officerName: "Officer John Smith",
    });
    check("POST /api/evidence stores metadata on IPFS and returns CID + tx ID", lCreate.status === 201 && /^Qm/.test(lCreate.data.cid) && /^[0-9a-f]{64}$/.test(lCreate.data.txId), lCreate.data);

    const lBulk = await call("POST", "/api/evidence/bulk", collector.token, {
        evidenceList: [
            { evidenceId: `${evidNo}_B1`, caseId: "CASE_99", description: "Photo of scene", officerName: "Officer Jane" },
            { evidenceId: `${evidNo}_B2`, caseId: "CASE_99", description: "USB drive", officerName: "Officer Jane" },
        ],
    });
    check("POST /api/evidence/bulk creates both items", lBulk.status === 201 && lBulk.data.successful === 2, lBulk.data);

    const lList = await call("GET", `/api/evidence?caseId=CASE_99&officer=Jane&search=usb&page=1&limit=10&startDate=2020-01-01&endDate=2099-12-31`, collector.token);
    check("GET /api/evidence filters by caseId/officer/search/dates", lList.status === 200 && lList.data.items.length === 1 && lList.data.items[0].evidenceId === `${evidNo}_B2`, lList.data);

    const byId = await call("GET", `/api/evidence/${evidNo}`, collector.token);
    const byCid = await call("GET", `/api/evidence/${lCreate.data.cid}`, collector.token);
    check("GET /api/evidence/:id works by evidence ID and by IPFS CID, with IPFS metadata",
        byId.data.ipfs_status === "OK" && byId.data.metadata?.officerName === "Officer John Smith" && byCid.data.evidenceId === evidNo, byId.data);

    const lPut = await call("PUT", `/api/evidence/${evidNo}`, collector.token, { caseId: "CASE_100", description: "Updated description", status: "PROCESSING" });
    check("PUT /api/evidence/:id pushes new metadata and updates the ledger pointer", lPut.status === 200 && lPut.data.cid !== lCreate.data.cid && lPut.data.evidence.status === "PROCESSING", lPut.data);

    const lStatus = await call("POST", `/api/evidence/${evidNo}/status`, collector.token, { newStatus: "ANALYZED", officerName: "Officer Smith", notes: "DNA analysis complete" });
    check("POST /api/evidence/:id/status → ANALYZED", lStatus.status === 200 && lStatus.data.status === "ANALYZED", lStatus.data);

    const lCoc = await call("POST", `/api/evidence/${evidNo}/chain-of-custody`, collector.token, { fromOfficer: "Carl Collector", toOfficer: "Farah Analyst", notes: "Transferred to lab" });
    const lCocGet = await call("GET", `/api/evidence/${evidNo}/chain-of-custody`, collector.token);
    check("Chain-of-custody add + get", lCoc.status === 201 && lCocGet.data.custodyChain?.[0]?.to === "Farah Analyst", lCocGet.data);

    const lDelBulk = await call("DELETE", "/api/evidence/bulk", admin.token, { evidenceIds: [`${evidNo}_B1`, `${evidNo}_B2`] });
    const lDelDenied = await call("DELETE", `/api/evidence/${evidNo}`, collector.token);
    check("Bulk delete (ADMIN) works; COLLECTOR delete → 403", lDelBulk.data.successful === 2 && lDelDenied.status === 403, [lDelBulk.data, lDelDenied.data]);

    // ---------------- Tamper detection ----------------
    await prisma.$executeRaw`UPDATE "Evidence" SET description = 'tampered' WHERE id = ${item2.data.evidence.id}`;
    const tampered = await call("POST", `/api/v1/evidence/${item2.data.evidence.id}/verify`, collector.token, {});
    await prisma.$executeRaw`UPDATE "Evidence" SET description = 'Crowbar' WHERE id = ${item2.data.evidence.id}`;
    const restored = await call("POST", `/api/v1/evidence/${item2.data.evidence.id}/verify`, collector.token, {});
    check("Direct DB edit is detected as TAMPERED (and VERIFIED again once reverted)",
        tampered.data.integrity?.status === "TAMPERED" && restored.data.integrity?.status === "VERIFIED", [tampered.data.integrity?.status, restored.data.integrity?.status]);

    console.log(`\n${step - failures}/${step} checks passed`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
