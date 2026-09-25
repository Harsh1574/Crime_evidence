"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Trash2, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, apiError, saveJson, statusClass } from "@/lib/api";
import { inputClass, primaryBtn, secondaryBtn, dangerBtn } from "@/components/ui/Modal";
import LottieLoader from "@/components/ui/LottieLoader";
import { cn } from "@/lib/utils";

interface DisposalRequest {
  id: string;
  status: string;
  reason: string;
  reviewNotes?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  certificate?: string | null;
  requester?: { fullName: string; role: string };
  reviewer?: { fullName: string } | null;
  evidence: { id: string; evidenceNumber?: string | null; caseId: string; type: string; description: string; status: string };
}

const FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All" },
];

export default function DisposalsPage() {
  const { can } = useAuth();
  const params = useParams();
  const userId = params.userId as string;

  const [filter, setFilter] = useState("pending");
  const [requests, setRequests] = useState<DisposalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/v1/disposals", { params: { status: filter || undefined } });
      setRequests(r.data.requests);
    } catch (e) {
      alert(apiError(e, "Failed to load disposal requests"));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id + decision);
    try {
      await api.post(`/api/v1/disposals/${id}/${decision}`, { note: notes[id] ?? "" });
      await load();
    } catch (e) {
      alert(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  const isJudge = can("approve_disposal");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Trash2 className="h-6 w-6 text-primary" /> Disposal Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isJudge ? "Approve or reject requests. A note is required to approve." : "Requests to dispose of evidence. Only a judge can decide them."}
          </p>
        </div>
        <button onClick={load} className={secondaryBtn}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={cn("px-3 py-1.5 rounded-md border text-sm", filter === f.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><LottieLoader size={120} /></div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">No disposal requests.</div>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/dashboard/${userId}/evidence/${r.evidence.id}`} className="font-semibold text-foreground hover:underline">
                    {r.evidence.evidenceNumber ?? r.evidence.id.slice(0, 8)} · {r.evidence.type}
                  </Link>
                  <p className="text-xs text-muted-foreground">Case {r.evidence.caseId} · {r.evidence.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(r.evidence.status)}`}>{r.evidence.status}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full border capitalize",
                    r.status === "pending" && "text-amber-400 bg-amber-400/10 border-amber-400/20",
                    r.status === "approved" && "text-red-400 bg-red-400/10 border-red-400/20",
                    r.status === "rejected" && "text-green-400 bg-green-400/10 border-green-400/20"
                  )}>{r.status}</span>
                </div>
              </div>
              <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {r.reason}</p>
              <p className="text-xs text-muted-foreground">Requested by {r.requester?.fullName} on {new Date(r.createdAt).toLocaleString()}</p>
              {r.reviewNotes && (
                <p className="text-xs text-muted-foreground italic">
                  {r.reviewer?.fullName} ({r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : ""}): &quot;{r.reviewNotes}&quot;
                </p>
              )}
              {r.certificate && (
                <button onClick={() => saveJson(JSON.parse(r.certificate!), `disposal-certificate-${r.id}.json`)} className="text-xs text-primary hover:underline">
                  Download disposal certificate
                </button>
              )}
              {r.status === "pending" && isJudge && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className={inputClass}
                    placeholder="Decision note (required to approve)"
                    value={notes[r.id] ?? ""}
                    onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <button onClick={() => decide(r.id, "approve")} disabled={!!busy || !(notes[r.id] ?? "").trim()} className={dangerBtn}>
                    {busy === r.id + "approve" && <Loader2 className="h-4 w-4 animate-spin" />} Approve & Dispose
                  </button>
                  <button onClick={() => decide(r.id, "reject")} disabled={!!busy} className={primaryBtn}>
                    {busy === r.id + "reject" && <Loader2 className="h-4 w-4 animate-spin" />} Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
