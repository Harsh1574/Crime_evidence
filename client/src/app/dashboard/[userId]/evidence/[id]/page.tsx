"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
    ArrowLeft,
    MapPin,
    Calendar,
    User,
    ShieldCheck,
    ShieldAlert,
    FileText,
    History,
    Loader2,
    Download,
    FileDown,
    ArrowRightLeft,
    Pencil,
    RefreshCw,
    Trash2,
    Receipt,
    Link2,
    Clock,
    GitCommit,
    Database,
    CheckCircle2,
    XCircle,
    MinusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
    api,
    apiError,
    downloadFile,
    saveJson,
    statusClass,
    STATUS_TRANSITIONS,
    TERMINAL_STATUSES,
    UserSummary,
} from "@/lib/api";
import { Modal, inputClass, textareaClass, primaryBtn, secondaryBtn, dangerBtn } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface EvidenceFile {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256Hash: string;
    ipfsCid?: string | null;
}

interface CustodyEvent {
    id: string;
    eventType: string;
    status: string;
    reason: string;
    signature?: string | null;
    timestamp: string;
    fromUser?: { fullName: string };
    toUser?: { fullName: string };
}

interface EvidenceDetail {
    id: string;
    evidenceNumber?: string | null;
    caseId: string;
    type: string;
    description: string;
    status: string;
    collectionDate: string;
    location: string;
    officerName?: string | null;
    officerNotes?: string | null;
    fileHash?: string | null;
    metadataHash?: string | null;
    ipfsCid?: string | null;
    ledgerTxId?: string | null;
    anchorStatus?: string;
    version?: number;
    currentCustodianId: string;
    collectedBy: { fullName: string };
    currentCustodian: { fullName: string };
    locked?: boolean;
    custodyEvents?: CustodyEvent[];
    files?: EvidenceFile[];
}

interface IntegrityResult {
    status: "VERIFIED" | "TAMPERED" | "UNVERIFIABLE";
    checkedAt: string;
    ledgerMode: string;
    ipfsMode: string;
    checks: { name: string; passed: boolean | null; expected?: string | null; actual?: string | null; detail?: string }[];
}

type ModalKind = "transfer" | "status" | "edit" | "disposal" | "verify" | null;

export default function EvidenceDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const userId = params.userId as string;
    const { user, can } = useAuth();
    const toast = useToast();

    const [evidence, setEvidence] = useState<EvidenceDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [modal, setModal] = useState<ModalKind>(null);

    // Transfer
    const [transferReason, setTransferReason] = useState("");
    const [recipientSearch, setRecipientSearch] = useState("");
    const [recipients, setRecipients] = useState<UserSummary[]>([]);
    const [targetUserId, setTargetUserId] = useState("");

    // Status / edit / disposal
    const [newStatus, setNewStatus] = useState("");
    const [statusNotes, setStatusNotes] = useState("");
    const [editForm, setEditForm] = useState({ description: "", location: "", officerNotes: "" });
    const [disposalReason, setDisposalReason] = useState("");

    // Verification
    const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);

    const load = useCallback(async () => {
        try {
            const response = await api.get(`/api/v1/evidence/${id}`);
            setEvidence(response.data.evidence);
            setError("");
        } catch (e) {
            setError(apiError(e, "Failed to load evidence details."));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (id) load();
    }, [id, load]);

    const refreshAll = async () => {
        await load();
        setRefreshKey((k) => k + 1);
    };

    // Recipient search for the transfer modal
    useEffect(() => {
        if (modal !== "transfer") return;
        const timer = setTimeout(() => {
            api.get("/api/v1/users", { params: { search: recipientSearch || undefined } })
                .then((r) => setRecipients((r.data.users as UserSummary[]).filter((u) => u.id !== user?.id)))
                .catch(() => setRecipients([]));
        }, 250);
        return () => clearTimeout(timer);
    }, [recipientSearch, modal, user?.id]);

    const run = async (key: string, fn: () => Promise<void>) => {
        setBusy(key);
        try {
            await fn();
        } catch (e) {
            toast.error(apiError(e));
        } finally {
            setBusy(null);
        }
    };

    const handleTransfer = () => run("transfer", async () => {
        await api.post(`/api/v1/custody/evidence/${id}/transfer`, { toUserId: targetUserId, reason: transferReason });
        setModal(null);
        setTransferReason("");
        setTargetUserId("");
        await refreshAll();
        toast.success("The recipient must accept it on their Chain of Custody page.", "Transfer requested");
    });

    const handleStatus = () => run("status", async () => {
        await api.post(`/api/v1/evidence/${id}/status`, { newStatus, notes: statusNotes || undefined });
        setModal(null);
        setStatusNotes("");
        await refreshAll();
        toast.success(`Status changed to ${newStatus}. New version anchored on the ledger.`);
    });

    const handleEdit = () => run("edit", async () => {
        await api.put(`/api/v1/evidence/${id}`, editForm);
        setModal(null);
        await refreshAll();
        toast.success("Details saved. New version anchored on the ledger.");
    });

    const handleDisposalRequest = () => run("disposal", async () => {
        await api.post(`/api/v1/evidence/${id}/disposal-requests`, { reason: disposalReason });
        setModal(null);
        setDisposalReason("");
        await refreshAll();
        toast.success("A judge must approve it before the evidence is disposed.", "Disposal requested");
    });

    const handleVerify = () => run("verify", async () => {
        const r = await api.post(`/api/v1/evidence/${id}/verify`, {});
        setIntegrity(r.data.integrity);
        setModal("verify");
        const status = r.data.integrity.status;
        if (status === "VERIFIED") toast.success("All integrity checks passed.", "VERIFIED");
        else if (status === "TAMPERED") toast.error("At least one integrity check failed.", "TAMPERED");
        else toast.warning("IPFS or the ledger could not be reached.", "UNVERIFIABLE");
    });

    const handleDownload = (fileId?: string) => run(fileId ? `file-${fileId}` : "download", async () => {
        const url = fileId ? `/api/v1/evidence/${id}/files/${fileId}/download` : `/api/v1/evidence/${id}/download`;
        const info = await downloadFile(url, "evidence-file");
        if (info.integrity === "TAMPERED") toast.error("The downloaded file no longer matches its recorded SHA-256 hash.", "Integrity warning");
        else toast.success("File downloaded. SHA-256 matches the recorded hash.");
    });

    const handleReport = () => run("report", async () => {
        await downloadFile(`/api/v1/evidence/${id}/report`, `evidence-report-${evidence?.evidenceNumber ?? id}.pdf`);
        toast.success("PDF report downloaded.");
    });

    const handleReceipt = () => run("receipt", async () => {
        const r = await api.get(`/api/v1/evidence/${id}/collection-receipt`);
        saveJson(r.data.receipt, `${r.data.receipt.receiptNumber}.json`);
        toast.success(`Receipt ${r.data.receipt.receiptNumber} downloaded.`);
    });

    const handleReanchor = () => run("anchor", async () => {
        const r = await api.post(`/api/v1/evidence/${id}/anchor`);
        await refreshAll();
        if (r.data.success) toast.success("Evidence anchored to IPFS and the ledger.");
        else toast.error(r.data.anchoring?.error ?? "Unknown error", "Anchoring failed");
    });

    const handleDelete = async () => {
        const ok = await toast.confirm({
            title: "Delete this evidence?",
            message: "The ledger keeps its history, but the record and files are removed from the system.",
            confirmLabel: "Delete",
            danger: true,
        });
        if (!ok) return;
        run("delete", async () => {
            await api.delete(`/api/v1/evidence/${id}`);
            toast.success("Evidence deleted. A DeleteAsset transaction was added to the ledger.");
            router.push(`/dashboard/${userId}/evidence`);
        });
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error || !evidence) {
        return (
            <div className="space-y-4 text-center">
                <p className="text-destructive">{error || "Evidence not found."}</p>
                <Link href={`/dashboard/${userId}/evidence`} className="text-primary hover:underline">
                    Return to Evidence Log
                </Link>
            </div>
        );
    }

    const terminal = TERMINAL_STATUSES.includes(evidence.status);
    const isCustodian = evidence.currentCustodianId === user?.id;
    const nextStatuses = STATUS_TRANSITIONS[evidence.status] ?? [];
    const canTransfer = can("transfer_evidence") && isCustodian && !evidence.locked && !terminal;
    const canChangeStatus = can("update_evidence_status") && !evidence.locked && !terminal && nextStatuses.length > 0;
    const canEdit = can("register_evidence") && !evidence.locked && !terminal;
    const canRequestDisposal = can("request_disposal") && !terminal;
    const hasFiles = (evidence.files?.length ?? 0) > 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative">
            {/* ── Modals ── */}
            {modal === "transfer" && (
                <Modal
                    title="Request Custody Transfer"
                    description="The recipient must accept the transfer before custody changes. The item is locked until then."
                    onClose={() => setModal(null)}
                    footer={
                        <>
                            <button onClick={() => setModal(null)} className={secondaryBtn}>Cancel</button>
                            <button onClick={handleTransfer} disabled={busy === "transfer" || !targetUserId || !transferReason.trim()} className={primaryBtn}>
                                {busy === "transfer" && <Loader2 className="h-4 w-4 animate-spin" />} Confirm Transfer
                            </button>
                        </>
                    }
                >
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Recipient</label>
                        <input className={inputClass} placeholder="Search by name, username or email" value={recipientSearch} onChange={(e) => setRecipientSearch(e.target.value)} />
                        <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
                            {recipients.length === 0 ? (
                                <p className="p-3 text-xs text-muted-foreground">No matching users.</p>
                            ) : recipients.map((u) => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => setTargetUserId(u.id)}
                                    className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted", targetUserId === u.id && "bg-primary/10 text-primary")}
                                >
                                    <span>{u.fullName} <span className="text-xs text-muted-foreground">@{u.username}</span></span>
                                    <span className="text-xs text-muted-foreground">{u.role.replace(/_/g, " ")}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Reason for Transfer</label>
                        <textarea className={textareaClass} placeholder="e.g. For forensic analysis" value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
                    </div>
                </Modal>
            )}

            {modal === "status" && (
                <Modal
                    title="Update Status"
                    description={`Current status: ${evidence.status}`}
                    onClose={() => setModal(null)}
                    footer={
                        <>
                            <button onClick={() => setModal(null)} className={secondaryBtn}>Cancel</button>
                            <button onClick={handleStatus} disabled={busy === "status" || !newStatus} className={primaryBtn}>
                                {busy === "status" && <Loader2 className="h-4 w-4 animate-spin" />} Update
                            </button>
                        </>
                    }
                >
                    <select className={inputClass} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                        <option value="">Select new status…</option>
                        {nextStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <textarea className={textareaClass} placeholder="Notes (optional), e.g. DNA analysis complete" value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Disposal is only possible through a judge-approved disposal request.</p>
                </Modal>
            )}

            {modal === "edit" && (
                <Modal
                    title="Edit Evidence Details"
                    description="Changes create a new version that is anchored on IPFS and the ledger."
                    onClose={() => setModal(null)}
                    footer={
                        <>
                            <button onClick={() => setModal(null)} className={secondaryBtn}>Cancel</button>
                            <button onClick={handleEdit} disabled={busy === "edit" || !editForm.description.trim() || !editForm.location.trim()} className={primaryBtn}>
                                {busy === "edit" && <Loader2 className="h-4 w-4 animate-spin" />} Save
                            </button>
                        </>
                    }
                >
                    <label className="text-sm font-medium">Description</label>
                    <textarea className={textareaClass} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                    <label className="text-sm font-medium">Location</label>
                    <input className={inputClass} value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} />
                    <label className="text-sm font-medium">Officer Notes</label>
                    <textarea className={textareaClass} value={editForm.officerNotes} onChange={(e) => setEditForm((f) => ({ ...f, officerNotes: e.target.value }))} />
                </Modal>
            )}

            {modal === "disposal" && (
                <Modal
                    title="Request Disposal"
                    description="Only a judge can approve disposal. The item becomes DISPOSED once approved."
                    onClose={() => setModal(null)}
                    footer={
                        <>
                            <button onClick={() => setModal(null)} className={secondaryBtn}>Cancel</button>
                            <button onClick={handleDisposalRequest} disabled={busy === "disposal" || !disposalReason.trim()} className={primaryBtn}>
                                {busy === "disposal" && <Loader2 className="h-4 w-4 animate-spin" />} Submit Request
                            </button>
                        </>
                    }
                >
                    <textarea className={textareaClass} placeholder="Reason for disposal" value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} />
                </Modal>
            )}

            {modal === "verify" && integrity && (
                <Modal title="Integrity Verification" onClose={() => setModal(null)} wide footer={<button onClick={() => setModal(null)} className={secondaryBtn}>Close</button>}>
                    <div className={cn(
                        "flex items-center gap-3 rounded-lg border p-4",
                        integrity.status === "VERIFIED" && "border-green-500/30 bg-green-500/10 text-green-400",
                        integrity.status === "TAMPERED" && "border-red-500/30 bg-red-500/10 text-red-400",
                        integrity.status === "UNVERIFIABLE" && "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    )}>
                        {integrity.status === "VERIFIED" ? <ShieldCheck className="h-8 w-8" /> : <ShieldAlert className="h-8 w-8" />}
                        <div>
                            <p className="text-lg font-bold">{integrity.status}</p>
                            <p className="text-xs opacity-80">Checked {new Date(integrity.checkedAt).toLocaleString()} · ledger: {integrity.ledgerMode} · IPFS: {integrity.ipfsMode}</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {integrity.checks.map((c) => (
                            <div key={c.name} className="rounded-md border border-border bg-background p-3 text-sm">
                                <div className="flex items-center gap-2">
                                    {c.passed === true ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : c.passed === false ? <XCircle className="h-4 w-4 text-red-400" /> : <MinusCircle className="h-4 w-4 text-amber-400" />}
                                    <span className="font-medium">{c.name}</span>
                                </div>
                                {c.detail && <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>}
                                {c.passed === false && c.expected !== undefined && (
                                    <p className="mt-1 text-xs font-mono break-all text-muted-foreground">expected {c.expected ?? "—"}<br />actual&nbsp;&nbsp;&nbsp;{c.actual ?? "—"}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </Modal>
            )}

            {/* ── Header ── */}
            <div className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                    <Link
                        href={`/dashboard/${userId}/evidence`}
                        className="rounded-full p-2 text-muted-foreground hover:bg-muted transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">{evidence.evidenceNumber ?? evidence.caseId}</h1>
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span>Case {evidence.caseId}</span>
                            <span>•</span>
                            <span className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                                evidence.type.toLowerCase() === "physical" && "bg-blue-500/10 text-blue-500",
                                evidence.type.toLowerCase() === "digital" && "bg-purple-500/10 text-purple-500",
                                evidence.type.toLowerCase() === "testimonial" && "bg-green-500/10 text-green-500"
                            )}>
                                {evidence.type}
                            </span>
                            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize border", statusClass(evidence.status))}>
                                {evidence.status}
                            </span>
                            {evidence.locked && (
                                <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">Transfer pending</span>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {canTransfer && (
                        <button onClick={() => { setRecipientSearch(""); setModal("transfer"); }} className={secondaryBtn}>
                            <ArrowRightLeft className="h-4 w-4" /> Request Transfer
                        </button>
                    )}
                    {canChangeStatus && (
                        <button onClick={() => { setNewStatus(""); setModal("status"); }} className={secondaryBtn}>
                            <RefreshCw className="h-4 w-4" /> Update Status
                        </button>
                    )}
                    {canEdit && (
                        <button
                            onClick={() => { setEditForm({ description: evidence.description, location: evidence.location, officerNotes: evidence.officerNotes ?? "" }); setModal("edit"); }}
                            className={secondaryBtn}
                        >
                            <Pencil className="h-4 w-4" /> Edit
                        </button>
                    )}
                    <button onClick={handleVerify} disabled={busy === "verify"} className={secondaryBtn}>
                        {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify Integrity
                    </button>
                    {hasFiles && (
                        <button onClick={() => handleDownload()} disabled={busy === "download"} className={secondaryBtn}>
                            {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download File
                        </button>
                    )}
                    <button onClick={handleReceipt} disabled={busy === "receipt"} className={secondaryBtn}>
                        {busy === "receipt" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />} Collection Receipt
                    </button>
                    {canRequestDisposal && (
                        <button onClick={() => setModal("disposal")} className={dangerBtn}>
                            <Trash2 className="h-4 w-4" /> Request Disposal
                        </button>
                    )}
                    {can("delete_evidence") && (
                        <button onClick={handleDelete} disabled={busy === "delete"} className={dangerBtn}>
                            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
                        </button>
                    )}
                    {can("generate_reports") && (
                        <button onClick={handleReport} disabled={busy === "report"} className={primaryBtn}>
                            {busy === "report" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Generate Report
                        </button>
                    )}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Main Info */}
                <div className="md:col-span-2 space-y-6">
                    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                        <h2 className="mb-4 flex items-center text-lg font-semibold">
                            <FileText className="mr-2 h-5 w-5 text-primary" />
                            Description & Context
                        </h2>
                        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            {evidence.description}
                        </p>
                        {evidence.officerNotes && (
                            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground whitespace-pre-wrap">
                                <span className="font-medium text-foreground">Officer notes:</span> {evidence.officerNotes}
                            </p>
                        )}
                    </div>

                    {/* Attachments Section */}
                    {hasFiles && (
                        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                            <h3 className="mb-3 text-lg font-semibold text-foreground flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" /> Attached Files
                            </h3>
                            <div className="space-y-2">
                                {evidence.files!.map((file) => (
                                    <div key={file.id} className="rounded-md border border-border bg-background p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="truncate">
                                                <p className="truncate text-sm font-medium text-foreground">{file.fileName}</p>
                                                <p className="text-xs text-muted-foreground">{file.mimeType} · {(file.fileSize / 1024).toFixed(1)} KB</p>
                                            </div>
                                            <button
                                                onClick={() => handleDownload(file.id)}
                                                disabled={busy === `file-${file.id}`}
                                                className="rounded-md p-2 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                                                title="Download"
                                            >
                                                {busy === `file-${file.id}` ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                                            </button>
                                        </div>
                                        <p className="mt-2 text-[11px] font-mono text-muted-foreground break-all">SHA-256 {file.sha256Hash}</p>
                                        {file.ipfsCid && <p className="text-[11px] font-mono text-muted-foreground break-all">IPFS {file.ipfsCid}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                        <h2 className="mb-4 flex items-center text-lg font-semibold">
                            <History className="mr-2 h-5 w-5 text-primary" />
                            Chain of Custody Timeline
                        </h2>
                        <div className="border-l-2 border-border ml-2 space-y-6 pl-6 relative">
                            <div className="relative">
                                <span className="absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground ring-4 ring-background"></span>
                                <p className="text-sm font-medium text-foreground">Collection</p>
                                <p className="text-xs text-muted-foreground">
                                    Collected by {evidence.officerName ?? evidence.collectedBy?.fullName} on {new Date(evidence.collectionDate).toLocaleDateString()}
                                </p>
                            </div>

                            {evidence.custodyEvents?.map((event) => (
                                <div key={event.id} className="relative">
                                    <span className={cn(
                                        "absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background",
                                        event.status === "pending" ? "bg-yellow-500" : event.status === "rejected" ? "bg-red-500" : "bg-blue-500"
                                    )}></span>
                                    <p className="text-sm font-medium text-foreground capitalize">{event.eventType} ({event.status})</p>
                                    <p className="text-xs text-muted-foreground">
                                        From: {event.fromUser?.fullName} → To: {event.toUser?.fullName}
                                    </p>
                                    <p className="text-xs text-muted-foreground italic mt-0.5">&quot;{event.reason}&quot;</p>
                                    {event.signature && <p className="text-[11px] font-mono text-muted-foreground break-all mt-0.5">sig {event.signature}</p>}
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {new Date(event.timestamp).toLocaleString()}
                                    </p>
                                </div>
                            ))}

                            <div className="relative">
                                <span className="absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full bg-green-500 ring-4 ring-background"></span>
                                <p className="text-sm font-medium text-foreground">Current Custodian</p>
                                <p className="text-xs text-muted-foreground">
                                    {evidence.currentCustodian?.fullName}
                                </p>
                            </div>
                        </div>
                    </div>

                    <VersionHistoryPanel evidenceId={id} refreshKey={refreshKey} />
                    <LedgerPanel evidenceRef={evidence.evidenceNumber ?? evidence.id} refreshKey={refreshKey} />
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                        <h3 className="mb-4 font-semibold text-foreground">Metadata</h3>
                        <div className="space-y-4">
                            <div className="flex items-start gap-3">
                                <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">Collected Date</p>
                                    <p className="text-sm text-foreground">{new Date(evidence.collectionDate).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">Location Found</p>
                                    <p className="text-sm text-foreground">{evidence.location || "N/A"}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">Collected By</p>
                                    <p className="text-sm text-foreground">{evidence.collectedBy?.fullName || "Unknown"}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">Current Status</p>
                                    <p className="text-sm text-foreground">{evidence.status}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Integrity */}
                    <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-3">
                        <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                            <Link2 className="h-4 w-4 text-primary" /> Integrity & Anchoring
                        </h3>
                        <HashRow label="Metadata SHA-256" value={evidence.metadataHash} />
                        <HashRow label="File SHA-256" value={evidence.fileHash} />
                        <HashRow label="Metadata IPFS CID" value={evidence.ipfsCid} />
                        <HashRow label="Ledger Tx ID" value={evidence.ledgerTxId} />
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Anchor status</span>
                            <span className={cn(
                                "rounded-full border px-2 py-0.5",
                                evidence.anchorStatus === "ANCHORED" ? "border-green-500/20 bg-green-500/10 text-green-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                            )}>
                                {evidence.anchorStatus ?? "—"} · v{evidence.version ?? 0}
                            </span>
                        </div>
                        {evidence.anchorStatus !== "ANCHORED" && can("register_evidence") && (
                            <button onClick={handleReanchor} disabled={busy === "anchor"} className={`${secondaryBtn} w-full`}>
                                {busy === "anchor" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Retry Anchoring
                            </button>
                        )}
                    </div>

                    <QRPanel evidenceId={id} />
                    <RetentionPanel evidenceId={id} refreshKey={refreshKey} canEdit={!user?.readOnly && (can("register_evidence") || can("manage_storage") || can("user_management"))} />
                </div>
            </div>

            {/* ── Extra Panels (full width below grid) ── */}
            <DisposalPanel evidenceId={id} refreshKey={refreshKey} onChanged={refreshAll} />
            <CommentsPanel evidenceId={id} />
            <LabResultsPanel evidenceId={id} />
            <AccessRequestPanel evidenceId={id} />
        </div>
    );
}

function HashRow({ label, value }: { label: string; value?: string | null }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-[11px] font-mono text-foreground break-all">{value || "—"}</p>
        </div>
    );
}

// ─── Version History Panel ────────────────────────────────────────
interface EvidenceVersion {
    id: string;
    version: number;
    action: string;
    changedByName: string;
    changedBy?: { fullName: string; role: string } | null;
    notes?: string | null;
    metadataHash: string;
    metadataCid?: string | null;
    ledgerTxId?: string | null;
    createdAt: string;
}

function VersionHistoryPanel({ evidenceId, refreshKey }: { evidenceId: string; refreshKey: number }) {
    const [versions, setVersions] = useState<EvidenceVersion[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        api.get(`/api/v1/evidence/${evidenceId}/versions`)
            .then((r) => setVersions(r.data.versions))
            .catch(console.warn)
            .finally(() => setLoading(false));
    }, [evidenceId, refreshKey]);

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <h2 className="flex items-center text-lg font-semibold">
                <GitCommit className="mr-2 h-5 w-5 text-primary" /> Version History
                <span className="ml-2 text-xs font-normal text-muted-foreground">({versions.length})</span>
            </h2>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No versions recorded.</p>
            ) : (
                <div className="space-y-2">
                    {[...versions].reverse().map((v) => (
                        <div key={v.id} className="rounded-md border border-border bg-background p-3 text-sm">
                            <button className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                                <span>
                                    <span className="font-mono text-xs text-primary">v{v.version}</span>{" "}
                                    <span className="font-medium">{v.action.replace(/_/g, " ")}</span>{" "}
                                    <span className="text-muted-foreground">by {v.changedBy?.fullName ?? v.changedByName}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                            </button>
                            {v.notes && <p className="mt-1 text-xs text-muted-foreground">{v.notes}</p>}
                            {expanded === v.id && (
                                <div className="mt-2 space-y-1 border-t border-border pt-2">
                                    <HashRow label="Metadata SHA-256" value={v.metadataHash} />
                                    <HashRow label="IPFS CID" value={v.metadataCid} />
                                    <HashRow label="Ledger Tx ID" value={v.ledgerTxId} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Ledger Record Panel (GET /api/evidence/:id — ledger + IPFS metadata) ──
interface LedgerRecord {
    ledger: { assetId: string; cid: string | null; txId: string | null; mode: string } | null;
    ledger_status: string;
    ipfs_status: string;
    metadata: Record<string, unknown> | null;
}

function LedgerPanel({ evidenceRef, refreshKey }: { evidenceRef: string; refreshKey: number }) {
    const toast = useToast();
    const [record, setRecord] = useState<LedgerRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get(`/api/evidence/${encodeURIComponent(evidenceRef)}`);
            setRecord(r.data);
        } catch (e) {
            toast.error(apiError(e, "Failed to read ledger record"));
        } finally {
            setLoading(false);
        }
    }, [evidenceRef, toast]);

    useEffect(() => {
        if (open) load();
    }, [open, load, refreshKey]);

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center text-lg font-semibold">
                    <Database className="mr-2 h-5 w-5 text-primary" /> Ledger & IPFS Record
                </h2>
                <button onClick={() => (open ? load() : setOpen(true))} disabled={loading} className="text-xs text-primary hover:underline disabled:opacity-50">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : open ? "Refresh" : "Load from ledger"}
                </button>
            </div>
            {open && record && (
                <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-border px-2 py-0.5">ledger: {record.ledger_status}</span>
                        <span className="rounded-full border border-border px-2 py-0.5">IPFS: {record.ipfs_status}</span>
                        {record.ledger && <span className="rounded-full border border-border px-2 py-0.5">mode: {record.ledger.mode}</span>}
                    </div>
                    {record.ledger && (
                        <>
                            <HashRow label="Asset ID" value={record.ledger.assetId} />
                            <HashRow label="CID on ledger" value={record.ledger.cid} />
                            <HashRow label="Latest Tx ID" value={record.ledger.txId} />
                        </>
                    )}
                    {record.metadata && (
                        <div>
                            <p className="text-xs text-muted-foreground mb-1">Metadata document on IPFS</p>
                            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-relaxed">
                                {JSON.stringify(record.metadata, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── QR Code Panel ────────────────────────────────────────────────
function QRPanel({ evidenceId }: { evidenceId: string }) {
    const toast = useToast();
    const [qrData, setQrData] = useState<{ qrDataUrl: string; verifyUrl: string } | null>(null);
    const [loading, setLoading] = useState(false);

    const generate = async () => {
        setLoading(true);
        try {
            const r = await api.get(`/api/v1/evidence/${evidenceId}/qr`);
            setQrData(r.data);
        } catch (e) { toast.error(apiError(e, "Failed to generate QR code")); }
        finally { setLoading(false); }
    };

    return (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Verification QR
            </h3>
            {qrData ? (
                <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrData.qrDataUrl} alt="QR Code" className="w-32 h-32 rounded-lg" />
                    <a href={qrData.verifyUrl} target="_blank" rel="noreferrer" className="block text-xs text-muted-foreground break-all hover:text-primary">{qrData.verifyUrl}</a>
                    <a href={qrData.qrDataUrl} download="evidence-qr.png" className="text-xs text-primary hover:underline">Download QR</a>
                </div>
            ) : (
                <button
                    onClick={generate}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                    Generate QR Code
                </button>
            )}
        </div>
    );
}

// ─── Retention Panel ──────────────────────────────────────────────
interface RetentionStatus {
    retentionDeadline: string | null;
    retentionPolicy: string | null;
    isExpired: boolean | null;
    daysUntilExpiry: number | null;
    actionRequired: boolean | null;
}

function RetentionPanel({ evidenceId, refreshKey, canEdit }: { evidenceId: string; refreshKey: number; canEdit: boolean }) {
    const toast = useToast();
    const [status, setStatus] = useState<RetentionStatus | null>(null);
    const [editing, setEditing] = useState(false);
    const [deadline, setDeadline] = useState("");
    const [policy, setPolicy] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        api.get(`/api/v1/evidence/${evidenceId}/retention-status`).then((r) => setStatus(r.data)).catch(console.warn);
    }, [evidenceId]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const save = async () => {
        setSaving(true);
        try {
            await api.put(`/api/v1/evidence/${evidenceId}/retention`, {
                retentionDeadline: deadline ? new Date(deadline).toISOString() : null,
                retentionPolicy: policy || null,
            });
            setEditing(false);
            load();
            toast.success("Retention updated.");
        } catch (e) { toast.error(apiError(e, "Failed to update retention")); }
        finally { setSaving(false); }
    };

    return (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> Retention
                </h3>
                {canEdit && !editing && (
                    <button
                        onClick={() => {
                            setDeadline(status?.retentionDeadline ? status.retentionDeadline.slice(0, 10) : "");
                            setPolicy(status?.retentionPolicy ?? "");
                            setEditing(true);
                        }}
                        className="text-xs text-primary hover:underline"
                    >
                        Edit
                    </button>
                )}
            </div>
            {editing ? (
                <div className="space-y-2">
                    <input type="date" className={inputClass} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                    <input className={inputClass} placeholder="Policy, e.g. 10 years after verdict" value={policy} onChange={(e) => setPolicy(e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={() => setEditing(false)} className={secondaryBtn}>Cancel</button>
                        <button onClick={save} disabled={saving} className={primaryBtn}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
                    </div>
                </div>
            ) : status?.retentionDeadline ? (
                <div className="text-sm space-y-1">
                    <p>Until {new Date(status.retentionDeadline).toLocaleDateString()}{status.retentionPolicy && <span className="text-muted-foreground"> · {status.retentionPolicy}</span>}</p>
                    <p className={cn("text-xs", status.isExpired ? "text-red-400" : "text-muted-foreground")}>
                        {status.isExpired ? `Expired ${Math.abs(status.daysUntilExpiry ?? 0)} day(s) ago${status.actionRequired ? " — action required" : ""}` : `${status.daysUntilExpiry} day(s) left`}
                    </p>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">No retention deadline set.</p>
            )}
        </div>
    );
}

// ─── Disposal Panel ───────────────────────────────────────────────
interface DisposalRequest {
    id: string;
    status: string;
    reason: string;
    reviewNotes?: string | null;
    createdAt: string;
    reviewedAt?: string | null;
    certificate?: string | null;
    requester?: { fullName: string };
    reviewer?: { fullName: string } | null;
}

function DisposalPanel({ evidenceId, refreshKey, onChanged }: { evidenceId: string; refreshKey: number; onChanged: () => Promise<void> }) {
    const { can } = useAuth();
    const toast = useToast();
    const [requests, setRequests] = useState<DisposalRequest[]>([]);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        api.get(`/api/v1/evidence/${evidenceId}/disposal-requests`).then((r) => setRequests(r.data)).catch(console.warn);
    }, [evidenceId]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const decide = async (requestId: string, decision: "approve" | "reject") => {
        setBusy(requestId + decision);
        try {
            await api.post(`/api/v1/disposals/${requestId}/${decision}`, { note: notes[requestId] ?? "" });
            load();
            await onChanged();
            if (decision === "approve") toast.success("Evidence is now DISPOSED. A certificate was issued.", "Disposal approved");
            else toast.info("The evidence status is unchanged.", "Disposal rejected");
        } catch (e) { toast.error(apiError(e)); }
        finally { setBusy(null); }
    };

    if (requests.length === 0) return null;

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-primary" /> Disposal Requests
                <span className="text-xs text-muted-foreground font-normal">({requests.length})</span>
            </h3>
            {requests.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-background p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Requested by {r.requester?.fullName}</span>
                        <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full border capitalize",
                            r.status === "pending" && "text-amber-400 bg-amber-400/10 border-amber-400/20",
                            r.status === "approved" && "text-red-400 bg-red-400/10 border-red-400/20",
                            r.status === "rejected" && "text-green-400 bg-green-400/10 border-green-400/20"
                        )}>{r.status === "approved" ? "approved — disposed" : r.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.reason}</p>
                    {r.reviewNotes && <p className="text-xs text-muted-foreground italic border-t border-border pt-1">{r.reviewer?.fullName}: &quot;{r.reviewNotes}&quot;</p>}
                    {r.certificate && (
                        <button onClick={() => saveJson(JSON.parse(r.certificate!), `disposal-certificate-${r.id}.json`)} className="text-xs text-primary hover:underline">
                            Download disposal certificate
                        </button>
                    )}
                    {r.status === "pending" && can("approve_disposal") && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                className={inputClass}
                                placeholder="Decision note (required to approve)"
                                value={notes[r.id] ?? ""}
                                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                            />
                            <button onClick={() => decide(r.id, "approve")} disabled={!!busy || !(notes[r.id] ?? "").trim()} className={dangerBtn}>
                                {busy === r.id + "approve" && <Loader2 className="h-4 w-4 animate-spin" />} Approve
                            </button>
                            <button onClick={() => decide(r.id, "reject")} disabled={!!busy} className={secondaryBtn}>
                                {busy === r.id + "reject" && <Loader2 className="h-4 w-4 animate-spin" />} Reject
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── Comments Panel ───────────────────────────────────────────────
interface Comment {
    id: string;
    content: string;
    createdAt: string;
    userId: string;
    user?: { fullName?: string; username?: string };
}

function CommentsPanel({ evidenceId }: { evidenceId: string }) {
    const { user } = useAuth();
    const toast = useToast();
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState("");
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        api.get(`/api/v1/evidence/${evidenceId}/comments`)
            .then(r => setComments(r.data)).catch(console.warn).finally(() => setLoading(false));
    }, [evidenceId]);

    const post = async () => {
        if (!content.trim()) return;
        setPosting(true);
        try {
            const r = await api.post(`/api/v1/evidence/${evidenceId}/comments`, { content });
            setComments(prev => [...prev, r.data]);
            setContent("");
            toast.success("Comment posted.");
        } catch (e) { toast.error(apiError(e, "Failed to post comment")); }
        finally { setPosting(false); }
    };

    const remove = async (commentId: string) => {
        if (!(await toast.confirm({ title: "Delete this comment?", confirmLabel: "Delete", danger: true }))) return;
        try {
            await api.delete(`/api/v1/evidence/${evidenceId}/comments/${commentId}`);
            setComments(prev => prev.filter(c => c.id !== commentId));
            toast.success("Comment deleted.");
        } catch (e) { toast.error(apiError(e, "Failed to delete comment")); }
    };

    const canModerate = user?.role === "admin" || user?.role === "head_officer";

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Officer Comments
                <span className="text-xs text-muted-foreground font-normal">({comments.length})</span>
            </h3>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
                <div className="space-y-3">
                    {comments.map((c) => (
                        <div key={c.id} className="rounded-lg border border-border bg-background p-3 space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-foreground">{c.user?.fullName || c.user?.username}</span>
                                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {new Date(c.createdAt).toLocaleString()}
                                    {!user?.readOnly && (c.userId === user?.id || canModerate) && (
                                        <button onClick={() => remove(c.id)} className="text-destructive hover:underline" title="Delete comment">
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    )}
                                </span>
                            </div>
                            <p className="text-sm text-foreground">{c.content}</p>
                        </div>
                    ))}
                </div>
            )}
            {!user?.readOnly && (
                <div className="flex gap-2">
                    <textarea
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
                        rows={2}
                        placeholder="Add a comment…"
                        value={content}
                        onChange={e => setContent(e.target.value)}
                    />
                    <button
                        onClick={post}
                        disabled={posting || !content.trim()}
                        className="px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 self-end py-2"
                    >
                        {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Lab Results Panel ────────────────────────────────────────────
interface LabResult {
    id: string;
    title: string;
    summary: string;
    findings?: string | null;
    submittedAt: string;
    submittedBy?: { fullName: string };
}

function LabResultsPanel({ evidenceId }: { evidenceId: string }) {
    const { user } = useAuth();
    const toast = useToast();
    const [results, setResults] = useState<LabResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: "", summary: "", findings: "" });
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        api.get(`/api/v1/evidence/${evidenceId}/lab-results`)
            .then(r => setResults(r.data)).catch(console.warn).finally(() => setLoading(false));
    }, [evidenceId]);

    const submit = async () => {
        if (!form.title || !form.summary) return;
        setPosting(true);
        try {
            const r = await api.post(`/api/v1/evidence/${evidenceId}/lab-results`, form);
            setResults(prev => [r.data, ...prev]);
            setShowForm(false);
            setForm({ title: "", summary: "", findings: "" });
            toast.success("Lab result submitted.");
        } catch (e) { toast.error(apiError(e, "Failed to submit lab result")); }
        finally { setPosting(false); }
    };

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" /> Lab Results
                    <span className="text-xs text-muted-foreground font-normal">({results.length})</span>
                </h3>
                {!user?.readOnly && (
                    <button onClick={() => setShowForm(s => !s)} className="text-xs text-primary hover:underline">
                        {showForm ? "Cancel" : "+ Submit Result"}
                    </button>
                )}
            </div>
            {showForm && (
                <div className="rounded-lg border border-border bg-background p-4 space-y-3">
                    <input className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" placeholder="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                    <textarea className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none" rows={2} placeholder="Summary *" value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
                    <textarea className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none" rows={3} placeholder="Detailed findings (optional)" value={form.findings} onChange={e => setForm(f => ({ ...f, findings: e.target.value }))} />
                    <button onClick={submit} disabled={posting || !form.title || !form.summary} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                        {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
                    </button>
                </div>
            )}
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : results.length === 0 && !showForm ? (
                <p className="text-sm text-muted-foreground">No lab results submitted yet.</p>
            ) : (
                <div className="space-y-3">
                    {results.map((r) => (
                        <div key={r.id} className="rounded-lg border border-border bg-background p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-foreground">{r.title}</span>
                                <span className="text-xs text-muted-foreground">{new Date(r.submittedAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-foreground">{r.summary}</p>
                            {r.findings && <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">{r.findings}</p>}
                            <p className="text-xs text-muted-foreground">By {r.submittedBy?.fullName}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Access Request Panel ─────────────────────────────────────────
interface AccessRequest {
    id: string;
    status: string;
    reason: string;
    reviewNotes?: string | null;
    requesterId: string;
    requester?: { fullName: string };
    reviewer?: { fullName: string } | null;
}

function AccessRequestPanel({ evidenceId }: { evidenceId: string }) {
    const { user, canAny } = useAuth();
    const toast = useToast();
    const [requests, setRequests] = useState<AccessRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [reason, setReason] = useState("");
    const [posting, setPosting] = useState(false);
    const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
    const [reviewing, setReviewing] = useState<string | null>(null);

    const load = useCallback(() => {
        api.get(`/api/v1/evidence/${evidenceId}/requests`)
            .then(r => setRequests(r.data)).catch(console.warn).finally(() => setLoading(false));
    }, [evidenceId]);

    useEffect(() => { load(); }, [load]);

    const submitRequest = async () => {
        if (!reason.trim()) return;
        setPosting(true);
        try {
            await api.post(`/api/v1/evidence/${evidenceId}/requests`, { reason });
            setReason("");
            load();
            toast.success("Access request sent. Custodians and admins have been notified.");
        } catch (e) {
            toast.error(apiError(e, "Request failed"));
        }
        finally { setPosting(false); }
    };

    const review = async (requestId: string, status: "approved" | "denied") => {
        setReviewing(requestId);
        try {
            await api.put(`/api/v1/evidence/${evidenceId}/requests/${requestId}`, { status, reviewNotes: reviewNotes[requestId] || undefined });
            load();
            toast.success(`Access request ${status}.`);
        } catch (e) { toast.error(apiError(e, "Review failed")); }
        finally { setReviewing(null); }
    };

    const canReview = canAny("approve_access", "user_management");

    const STATUS_BADGE: Record<string, string> = {
        pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
        approved: "text-green-400 bg-green-400/10 border-green-400/20",
        denied: "text-red-400 bg-red-400/10 border-red-400/20",
    };

    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Access Requests
                <span className="text-xs text-muted-foreground font-normal">({requests.length})</span>
            </h3>
            {requests.length > 0 && (
                <div className="space-y-2">
                    {requests.map((r) => (
                        <div key={r.id} className="rounded-lg border border-border bg-background p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-foreground">{r.requester?.fullName}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_BADGE[r.status] || ""}`}>{r.status}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">{r.reason}</p>
                            {r.reviewNotes && <p className="text-xs text-muted-foreground italic border-t border-border pt-1 mt-1">{r.reviewer?.fullName}: &quot;{r.reviewNotes}&quot;</p>}
                            {r.status === "pending" && canReview && r.requesterId !== user?.id && (
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                        className={inputClass}
                                        placeholder="Review note (optional)"
                                        value={reviewNotes[r.id] ?? ""}
                                        onChange={(e) => setReviewNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                                    />
                                    <button onClick={() => review(r.id, "approved")} disabled={reviewing === r.id} className={primaryBtn}>Approve</button>
                                    <button onClick={() => review(r.id, "denied")} disabled={reviewing === r.id} className={dangerBtn}>Deny</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {!loading && !user?.readOnly && (
                <div className="flex gap-2">
                    <input
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                        placeholder="Reason for requesting access…"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                    />
                    <button
                        onClick={submitRequest}
                        disabled={posting || !reason.trim()}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                        {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request"}
                    </button>
                </div>
            )}
        </div>
    );
}
