/**
 * Evidence report (PDF) — details, live integrity check, file hashes, IPFS CIDs,
 * chain of custody, version history and the ledger transactions for the asset.
 */
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { ServiceError, verifyEvidence } from "./evidence.js";
import { getAssetHistory } from "./ledger.js";
const MONO = "Courier";
const BODY = "Helvetica";
const BOLD = "Helvetica-Bold";
export async function generateEvidenceReport(evidenceId, generatedBy) {
    const ev = await prisma.evidence.findUnique({
        where: { id: evidenceId },
        include: {
            collectedBy: { select: { fullName: true, username: true, badgeNumber: true, department: true } },
            currentCustodian: { select: { fullName: true, username: true, badgeNumber: true, department: true } },
            caseRef: { select: { caseNumber: true, title: true } },
            files: { orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] },
            custodyEvents: {
                orderBy: { timestamp: "asc" },
                include: { fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } } },
            },
            versions: { orderBy: { version: "asc" } },
        },
    });
    if (!ev)
        throw new ServiceError(404, "Evidence not found.");
    const assetId = ev.evidenceNumber ?? ev.id;
    const [integrity, ledgerTxs] = await Promise.all([verifyEvidence(evidenceId), getAssetHistory(assetId)]);
    const generatedAt = new Date();
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Evidence Report ${assetId}`, Author: "Crime Evidence Management System" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });
    const heading = (text) => {
        doc.moveDown(0.8).font(BOLD).fontSize(13).fillColor("#111111").text(text);
        doc.moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#999999").stroke();
        doc.moveDown(0.4);
    };
    const field = (label, value, mono = false) => {
        doc.font(BOLD).fontSize(9).fillColor("#333333").text(`${label}: `, { continued: true });
        doc.font(mono ? MONO : BODY).fontSize(9).fillColor("#000000").text(value === null || value === undefined || value === "" ? "—" : String(value));
    };
    // Title
    doc.font(BOLD).fontSize(18).text("Evidence Integrity & Chain of Custody Report", { align: "center" });
    doc.moveDown(0.3).font(BODY).fontSize(9).fillColor("#555555")
        .text(`Generated ${generatedAt.toISOString()} by ${generatedBy.username} (${generatedBy.role})`, { align: "center" });
    // Summary
    heading("Evidence");
    field("Evidence ID", assetId, true);
    field("System ID", ev.id, true);
    field("Case", ev.caseRef ? `${ev.caseRef.caseNumber ?? ev.caseId} — ${ev.caseRef.title}` : ev.caseId);
    field("Type", ev.type);
    field("Status", ev.status.toUpperCase());
    field("Description", ev.description);
    field("Location", ev.location);
    field("Collected", ev.collectionDate.toISOString());
    field("Collected by", `${ev.collectedBy.fullName} (${ev.collectedBy.username}${ev.collectedBy.badgeNumber ? `, ${ev.collectedBy.badgeNumber}` : ""})`);
    field("Current custodian", `${ev.currentCustodian.fullName} (${ev.currentCustodian.username})`);
    field("Registered", ev.createdAt.toISOString());
    // Integrity
    heading("Integrity");
    doc.font(BOLD).fontSize(12).fillColor(integrity.status === "VERIFIED" ? "#15803d" : integrity.status === "TAMPERED" ? "#b91c1c" : "#a16207")
        .text(`Result: ${integrity.status}`);
    doc.fillColor("#000000").moveDown(0.3);
    field("Metadata SHA-256", ev.metadataHash, true);
    field("File SHA-256", ev.fileHash, true);
    field("Metadata IPFS CID", ev.ipfsCid, true);
    field("Latest ledger tx ID", ev.ledgerTxId, true);
    field("Ledger / IPFS mode", `${integrity.ledgerMode} / ${integrity.ipfsMode}`);
    field("Anchor status", `${ev.anchorStatus} (version ${ev.version})`);
    doc.moveDown(0.3);
    for (const check of integrity.checks) {
        const mark = check.passed === true ? "PASS" : check.passed === false ? "FAIL" : "N/A ";
        doc.font(MONO).fontSize(8).text(`[${mark}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    // Files
    heading(`Files (${ev.files.length})`);
    if (ev.files.length === 0)
        doc.font(BODY).fontSize(9).text("No files attached.");
    for (const f of ev.files) {
        doc.font(BOLD).fontSize(9).text(`${f.fileName}  (${f.mimeType}, ${f.fileSize} bytes)`);
        field("  SHA-256", f.sha256Hash, true);
        field("  IPFS CID", f.ipfsCid, true);
        doc.moveDown(0.2);
    }
    // Chain of custody
    heading(`Chain of Custody (${ev.custodyEvents.length})`);
    if (ev.custodyEvents.length === 0)
        doc.font(BODY).fontSize(9).text("Evidence has not been transferred.");
    for (const e of ev.custodyEvents) {
        doc.font(BOLD).fontSize(9).text(`${e.timestamp.toISOString()}  ${e.fromUser.fullName} → ${e.toUser.fullName}  [${e.status.toUpperCase()}]`);
        doc.font(BODY).fontSize(9).text(`  ${e.reason}`);
        if (e.signature)
            field("  Signature", e.signature, true);
        doc.moveDown(0.2);
    }
    // Version history
    heading(`Version History (${ev.versions.length})`);
    for (const v of ev.versions) {
        doc.font(BOLD).fontSize(9).text(`v${v.version}  ${v.action}  by ${v.changedByName}  at ${v.createdAt.toISOString()}`);
        if (v.notes)
            doc.font(BODY).fontSize(9).text(`  ${v.notes}`);
        field("  Metadata SHA-256", v.metadataHash, true);
        field("  CID", v.metadataCid, true);
        field("  Tx ID", v.ledgerTxId, true);
        doc.moveDown(0.2);
    }
    // Ledger transactions
    heading(`Ledger Transactions (${ledgerTxs.length})`);
    for (const t of ledgerTxs) {
        doc.font(BOLD).fontSize(9).text(`Block #${t.blockNumber}  ${t.function}  ${t.createdAt.toISOString()}  (${t.mode})`);
        field("  Tx ID", t.txId, true);
        field("  Block hash", t.blockHash, true);
        doc.moveDown(0.2);
    }
    doc.end();
    const buffer = await done;
    const safeId = assetId.replace(/[^A-Za-z0-9_-]/g, "_");
    return { buffer, fileName: `evidence-report-${safeId}-${generatedAt.toISOString().slice(0, 10)}.pdf` };
}
//# sourceMappingURL=report.js.map