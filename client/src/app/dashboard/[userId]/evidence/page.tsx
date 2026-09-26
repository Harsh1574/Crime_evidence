"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, FileText, ArrowRight, Box, Upload, Trash2, Loader2, Hash, X } from "lucide-react";
import LottieLoader from "@/components/ui/LottieLoader";
import { cn } from "@/lib/utils";
import { useCrimeBox } from "@/context/CrimeBoxContext";
import { useAuth } from "@/context/AuthContext";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, apiError, ALL_STATUSES, statusClass } from "@/lib/api";
import { Modal, inputClass, textareaClass, primaryBtn, secondaryBtn } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface Evidence {
    id: string;
    evidenceNumber?: string | null;
    caseId: string;
    type: string;
    description: string;
    status: string;
    locked?: boolean;
    anchorStatus?: string;
    collectionDate: string;
    collectedBy: { fullName: string };
    currentCustodian: { fullName: string };
}

const BULK_EXAMPLE = `[
  { "evidenceId": "EVID_2026_101", "caseId": "CASE_99", "description": "Photo of scene", "officerName": "Officer Jane" },
  { "evidenceId": "EVID_2026_102", "caseId": "CASE_99", "description": "USB drive", "officerName": "Officer Jane" }
]`;

export default function EvidenceListPage() {
    const { permission, activeBox } = useCrimeBox();
    const { can } = useAuth();
    const toast = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const params = useParams();
    const userId = params.userId as string;
    const queryCaseId = searchParams.get("caseId") ?? "";

    const [evidence, setEvidence] = useState<Evidence[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [status, setStatus] = useState("");
    const [type, setType] = useState("");
    const [officer, setOfficer] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
    const [reloadKey, setReloadKey] = useState(0);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    const [lookup, setLookup] = useState("");
    const [lookingUp, setLookingUp] = useState(false);

    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState(BULK_EXAMPLE);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkResult, setBulkResult] = useState<{ successful: number; failed: number; results: { evidenceId: string | null; success: boolean; error?: string }[] } | null>(null);

    const caseFilter = activeBox?.caseId || queryCaseId || undefined;
    const canRegister = permission === "read-write" || (!activeBox && can("register_evidence"));
    const canDelete = can("delete_evidence");

    const fetchEvidence = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get("/api/v1/evidence", {
                params: {
                    search: searchTerm || undefined,
                    status: status || undefined,
                    type: type || undefined,
                    officer: officer || undefined,
                    startDate: startDate || undefined,
                    endDate: endDate || undefined,
                    page: pagination.page,
                    limit: 10,
                    caseId: caseFilter,
                },
            });
            setEvidence(response.data.evidence);
            setPagination((p) => ({ ...p, totalPages: Math.max(1, response.data.pagination.totalPages), total: response.data.pagination.total }));
        } catch (error) {
            console.error("Failed to fetch evidence:", error);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, status, type, officer, startDate, endDate, pagination.page, caseFilter]);

    useEffect(() => {
        const timer = setTimeout(fetchEvidence, 400); // Debounce search
        return () => clearTimeout(timer);
    }, [fetchEvidence, reloadKey]);

    const resetPage = () => setPagination((p) => ({ ...p, page: 1 }));

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const bulkDelete = async () => {
        if (selected.size === 0) return;
        const ok = await toast.confirm({
            title: `Delete ${selected.size} evidence item(s)?`,
            message: "The ledger keeps their history, but the records and files are removed from the system.",
            confirmLabel: "Delete",
            danger: true,
        });
        if (!ok) return;
        setDeleting(true);
        try {
            const r = await api.delete("/api/evidence/bulk", { data: { evidenceIds: [...selected] } });
            if (r.data.failed > 0) toast.warning(`Deleted ${r.data.successful}, failed ${r.data.failed}.`);
            else toast.success(`Deleted ${r.data.successful} item(s).`);
            setSelected(new Set());
            setReloadKey((k) => k + 1);
        } catch (e) {
            toast.error(apiError(e, "Bulk delete failed"));
        } finally {
            setDeleting(false);
        }
    };

    const doLookup = async () => {
        const ref = lookup.trim();
        if (!ref) return;
        setLookingUp(true);
        try {
            const r = await api.get(`/api/v1/evidence/${encodeURIComponent(ref)}`);
            router.push(`/dashboard/${userId}/evidence/${r.data.evidence.id}`);
        } catch (e) {
            toast.error(apiError(e, "No evidence found for that ID, evidence number or CID."));
        } finally {
            setLookingUp(false);
        }
    };

    const submitBulk = async () => {
        let list: unknown;
        try {
            list = JSON.parse(bulkText);
        } catch {
            toast.error("The bulk list must be valid JSON (an array of evidence objects).");
            return;
        }
        if (!Array.isArray(list)) { toast.error("The bulk list must be a JSON array."); return; }
        setBulkBusy(true);
        try {
            const r = await api.post("/api/evidence/bulk", { evidenceList: list });
            setBulkResult(r.data);
            if (r.data.failed > 0) toast.warning(`Imported ${r.data.successful}, failed ${r.data.failed}. See details below.`);
            else toast.success(`Imported ${r.data.successful} item(s).`);
            setReloadKey((k) => k + 1);
        } catch (e: unknown) {
            const data = (e as { response?: { data?: typeof bulkResult } }).response?.data;
            if (data?.results) setBulkResult(data);
            else toast.error(apiError(e, "Bulk import failed"));
        } finally {
            setBulkBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Evidence</h1>
                    <p className="text-muted-foreground text-sm mt-1 mb-2">
                        View and manage all evidence records. {pagination.total > 0 && `${pagination.total} item(s).`}
                    </p>
                    {activeBox && (
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 text-primary text-xs font-medium rounded-md">
                            <Box className="h-3 w-3" />
                            {activeBox.name} &mdash; {activeBox.caseId}
                        </div>
                    )}
                    {!activeBox && queryCaseId && (
                        <Link href={`/dashboard/${userId}/evidence`} className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 text-primary text-xs font-medium rounded-md">
                            Case filter: {queryCaseId} <X className="h-3 w-3" />
                        </Link>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {can("register_evidence") && (
                        <button onClick={() => { setBulkResult(null); setBulkOpen(true); }} className={secondaryBtn}>
                            <Upload className="h-4 w-4" /> Bulk Import
                        </button>
                    )}
                    {canRegister && (
                        <Link
                            href={`/dashboard/${userId}/evidence/new`}
                            className="flex items-center justify-center bg-primary text-black px-6 py-2 text-sm font-bold uppercase tracking-wide hover:bg-primary/90 transition-all"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Log New Item
                        </Link>
                    )}
                </div>
            </div>

            {/* Search + lookup */}
            <div className="grid gap-3 lg:grid-cols-3">
                <div className="lg:col-span-2 flex items-center rounded-lg border border-border bg-card px-4 py-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
                    <Search className="mr-3 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by evidence ID, case ID, description or location..."
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
                    />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Open by ID / EVID_… / IPFS CID"
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                        value={lookup}
                        onChange={(e) => setLookup(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doLookup()}
                    />
                    <button onClick={doLookup} disabled={lookingUp || !lookup.trim()} className="text-xs text-primary hover:underline disabled:opacity-50">
                        {lookingUp ? <Loader2 className="h-3 w-3 animate-spin" /> : "Open"}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }}>
                    <option value="">All statuses</option>
                    {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className={inputClass} value={type} onChange={(e) => { setType(e.target.value); resetPage(); }}>
                    <option value="">All types</option>
                    <option value="Physical">Physical</option>
                    <option value="Digital">Digital</option>
                    <option value="Testimonial">Testimonial</option>
                </select>
                <input className={inputClass} placeholder="Officer name" value={officer} onChange={(e) => { setOfficer(e.target.value); resetPage(); }} />
                <input className={inputClass} type="date" title="Registered from" value={startDate} onChange={(e) => { setStartDate(e.target.value); resetPage(); }} />
                <input className={inputClass} type="date" title="Registered until" value={endDate} onChange={(e) => { setEndDate(e.target.value); resetPage(); }} />
            </div>

            {canDelete && selected.size > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
                    <span>{selected.size} selected</span>
                    <button onClick={bulkDelete} disabled={deleting} className="inline-flex items-center gap-2 text-destructive hover:underline disabled:opacity-50">
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete selected
                    </button>
                </div>
            )}

            <div className="rounded-lg border border-border bg-card overflow-hidden">
                {loading ? (
                    <div className="flex h-40 items-center justify-center text-muted-foreground">
                        <LottieLoader size={120} />
                    </div>
                ) : evidence.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <FileText className="mb-4 h-12 w-12 opacity-20" />
                        <p>No evidence found.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground uppercase">
                                <tr>
                                    {canDelete && <th className="px-4 py-3" />}
                                    <th className="px-6 py-3 font-medium">Evidence ID</th>
                                    <th className="px-6 py-3 font-medium">Case ID</th>
                                    <th className="px-6 py-3 font-medium">Type</th>
                                    <th className="px-6 py-3 font-medium">Description</th>
                                    <th className="px-6 py-3 font-medium">Status</th>
                                    <th className="px-6 py-3 font-medium">Custodian</th>
                                    <th className="px-6 py-3 font-medium text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {evidence.map((item) => (
                                    <tr key={item.id} className="group hover:bg-muted/50 transition-colors">
                                        {canDelete && (
                                            <td className="px-4 py-4">
                                                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                                            </td>
                                        )}
                                        <td className="px-6 py-4 font-mono text-xs text-foreground whitespace-nowrap">
                                            {item.evidenceNumber ?? item.id.substring(0, 8)}
                                            {item.locked && <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">transfer pending</span>}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-foreground text-sm max-w-[160px] truncate" title={item.caseId}>
                                            {item.caseId}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md capitalize",
                                                item.type.toLowerCase() === "physical" && "bg-blue-500/10 text-blue-400",
                                                item.type.toLowerCase() === "digital" && "bg-purple-500/10 text-purple-400",
                                                item.type.toLowerCase() === "testimonial" && "bg-amber-500/10 text-amber-400"
                                            )}>
                                                {item.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 max-w-xs truncate text-muted-foreground" title={item.description}>
                                            {item.description}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize border", statusClass(item.status))}>
                                                {item.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground text-sm">
                                            {item.currentCustodian?.fullName || "—"}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Link
                                                href={`/dashboard/${userId}/evidence/${item.id}`}
                                                className="inline-flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                            >
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>Page {pagination.page} of {pagination.totalPages}</span>
                <div className="space-x-2">
                    <button
                        disabled={pagination.page <= 1}
                        onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                        className="px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors text-sm"
                    >
                        Previous
                    </button>
                    <button
                        disabled={pagination.page >= pagination.totalPages}
                        onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                        className="px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50 transition-colors text-sm"
                    >
                        Next
                    </button>
                </div>
            </div>

            {bulkOpen && (
                <Modal
                    title="Bulk Import Evidence"
                    description="Paste a JSON array. Each item needs caseId and description; evidenceId, officerName, type, location and collectionDate are optional. Up to 50 items."
                    onClose={() => setBulkOpen(false)}
                    wide
                    footer={
                        <>
                            <button onClick={() => setBulkOpen(false)} className={secondaryBtn}>Close</button>
                            <button onClick={submitBulk} disabled={bulkBusy} className={primaryBtn}>
                                {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />} Import
                            </button>
                        </>
                    }
                >
                    <textarea className={`${textareaClass} font-mono min-h-[200px]`} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
                    {bulkResult && (
                        <div className="rounded-md border border-border bg-background p-3 text-sm space-y-1">
                            <p className="font-medium">Imported {bulkResult.successful}, failed {bulkResult.failed}</p>
                            {bulkResult.results.map((r, i) => (
                                <p key={i} className={r.success ? "text-green-400 text-xs" : "text-red-400 text-xs"}>
                                    {r.evidenceId ?? `item ${i + 1}`}: {r.success ? "created" : r.error}
                                </p>
                            ))}
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
