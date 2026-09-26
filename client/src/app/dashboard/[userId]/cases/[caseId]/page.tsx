"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCrimeBox } from "@/context/CrimeBoxContext";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Box, Loader2, ExternalLink, Pencil, Check, X, Users, UserPlus, UserMinus, FileText, Plus, Link2 } from "lucide-react";
import { api, apiError, statusClass, UserSummary } from "@/lib/api";
import { inputClass } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface CaseDetail {
  id: string;
  caseNumber?: string | null;
  title: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  createdBy: { fullName: string; username: string };
  crimeBoxes: { id: string; name: string; caseId?: string; createdAt: string }[];
  officers: { id: string; userId: string; createdAt: string; user: UserSummary }[];
  evidence: { id: string; evidenceNumber?: string | null; type: string; description: string; status: string; createdAt: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-green-400 bg-green-400/10 border-green-400/20",
  active: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  closed: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  suspended: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

const STATUSES = ["open", "active", "suspended", "closed"];

export default function CaseDetailPage() {
  const { token, user, can, canAny } = useAuth();
  const { activeBox } = useCrimeBox();
  const toast = useToast();
  const params = useParams();
  const userId = params.userId as string;
  const caseId = params.caseId as string;

  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStatus, setEditStatus] = useState("open");
  const [saving, setSaving] = useState(false);

  const [officerSearch, setOfficerSearch] = useState("");
  const [candidates, setCandidates] = useState<UserSummary[]>([]);
  const [officerBusy, setOfficerBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/v1/cases/${caseId}`);
      setCaseData(r.data);
      setEditTitle(r.data.title);
      setEditDesc(r.data.description ?? "");
      setEditStatus(r.data.status);
      setError("");
    } catch (e) {
      setError(apiError(e, "Case not found."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const canManageOfficers = !!caseData && can("manage_case_officers") && (caseData.createdById === user?.id || user?.role === "admin");

  // User search for adding officers
  useEffect(() => {
    if (!canManageOfficers) return;
    const timer = setTimeout(() => {
      api.get("/api/v1/users", { params: { search: officerSearch || undefined } })
        .then(r => setCandidates(r.data.users))
        .catch(() => setCandidates([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [officerSearch, canManageOfficers]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/v1/cases/${caseId}`, { title: editTitle, description: editDesc, status: editStatus });
      setEditing(false);
      await load();
      toast.success("Case updated.");
    } catch (e) { toast.error(apiError(e, "Failed to update case")); }
    finally { setSaving(false); }
  };

  const addOfficer = async (officer: UserSummary) => {
    setOfficerBusy(officer.id);
    try {
      await api.post(`/api/v1/cases/${caseId}/officers`, { userId: officer.id });
      setOfficerSearch("");
      await load();
      toast.success(`${officer.fullName} added to the case and notified.`);
    } catch (e) { toast.error(apiError(e, "Failed to add officer")); }
    finally { setOfficerBusy(null); }
  };

  const removeOfficer = async (officerId: string, name: string) => {
    const ok = await toast.confirm({
      title: `Remove ${name}?`,
      message: "They will lose access to this case's evidence unless they collected or hold it.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setOfficerBusy(officerId);
    try {
      await api.delete(`/api/v1/cases/${caseId}/officers/${officerId}`);
      await load();
      toast.success(`${name} removed from the case.`);
    } catch (e) { toast.error(apiError(e, "Failed to remove officer")); }
    finally { setOfficerBusy(null); }
  };

  const linkActiveBox = async () => {
    if (!activeBox) return;
    setLinking(true);
    try {
      await api.post(`/api/v1/cases/${caseId}/boxes`, { boxId: activeBox.id });
      await load();
      toast.success(`Crime Box "${activeBox.name}" linked to this case.`);
    } catch (e) { toast.error(apiError(e, "Failed to link Crime Box")); }
    finally { setLinking(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!caseData) return <p className="text-muted-foreground text-center mt-12">{error || "Case not found."}</p>;

  const assignedIds = new Set(caseData.officers.map(o => o.userId));
  const boxLinked = !!activeBox && caseData.crimeBoxes.some(b => b.id === activeBox.id);

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href={`/dashboard/${userId}/cases`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Cases
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-3">
              <input
                className="w-full text-2xl font-bold bg-transparent border-b border-primary focus:outline-none text-foreground"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                rows={2}
                placeholder="Description"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
              />
              <select
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                value={editStatus}
                onChange={e => setEditStatus(e.target.value)}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ) : (
            <>
              {caseData.caseNumber && <p className="font-mono text-sm text-primary">{caseData.caseNumber}</p>}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">{caseData.title}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${STATUS_COLORS[caseData.status] || STATUS_COLORS.open}`}>
                  {caseData.status}
                </span>
              </div>
              {caseData.description && <p className="text-muted-foreground text-sm mt-1">{caseData.description}</p>}
              <p className="text-xs text-muted-foreground mt-2">Created by {caseData.createdBy.fullName} · {new Date(caseData.createdAt).toLocaleDateString()} · Updated {new Date(caseData.updatedAt).toLocaleString()}</p>
            </>
          )}
        </div>
        {can("manage_cases") && (
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                <button onClick={save} disabled={saving || !editTitle.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Case Officers */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Case Officers
            <span className="text-xs font-normal text-muted-foreground">({caseData.officers.length})</span>
          </h3>
          {caseData.officers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No officers assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {caseData.officers.map(o => (
                <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                  <div>
                    <p className="text-sm font-medium text-foreground">{o.user.fullName} <span className="text-xs text-muted-foreground">@{o.user.username}</span></p>
                    <p className="text-xs text-muted-foreground">{o.user.role.replace(/_/g, " ")}{o.user.department ? ` · ${o.user.department}` : ""}</p>
                  </div>
                  {canManageOfficers && (
                    <button
                      onClick={() => removeOfficer(o.userId, o.user.fullName)}
                      disabled={officerBusy === o.userId}
                      className="flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50"
                    >
                      {officerBusy === o.userId ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />} Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canManageOfficers && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">Add officer</p>
              <input className={inputClass} placeholder="Search users by name, username or email" value={officerSearch} onChange={e => setOfficerSearch(e.target.value)} />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {candidates.filter(c => !assignedIds.has(c.id)).length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No users to add.</p>
                ) : candidates.filter(c => !assignedIds.has(c.id)).map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{c.fullName} <span className="text-xs text-muted-foreground">{c.role.replace(/_/g, " ")}</span></span>
                    <button onClick={() => addOfficer(c)} disabled={officerBusy === c.id} className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50">
                      {officerBusy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Evidence in this case */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Evidence
              <span className="text-xs font-normal text-muted-foreground">({caseData.evidence.length})</span>
            </h3>
            {can("register_evidence") && (
              <Link href={`/dashboard/${userId}/evidence/new?caseId=${encodeURIComponent(caseData.caseNumber ?? caseData.id)}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3 w-3" /> Register evidence
              </Link>
            )}
          </div>
          {caseData.evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evidence filed under this case yet.</p>
          ) : (
            <div className="space-y-2">
              {caseData.evidence.map(ev => (
                <Link key={ev.id} href={`/dashboard/${userId}/evidence/${ev.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:border-primary/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground"><span className="font-mono text-xs text-primary">{ev.evidenceNumber}</span> {ev.type}</p>
                    <p className="text-xs text-muted-foreground truncate">{ev.description}</p>
                  </div>
                  <span className={`ml-2 shrink-0 text-xs px-2 py-0.5 rounded-full border ${statusClass(ev.status)}`}>{ev.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Crime Boxes */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Box className="h-4 w-4 text-primary" /> Crime Boxes in this Case
          </h3>
          {activeBox && !boxLinked && canAny("register_evidence") && (
            <button onClick={linkActiveBox} disabled={linking} className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50">
              {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link active box &quot;{activeBox.name}&quot;
            </button>
          )}
        </div>
        {caseData.crimeBoxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No crime boxes linked yet. Join a Crime Box, then link it here.</p>
        ) : (
          <div className="space-y-2">
            {caseData.crimeBoxes.map(box => (
              <div key={box.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                <div>
                  <p className="text-sm font-medium text-foreground">{box.name}</p>
                  <p className="text-xs text-muted-foreground">Linked {new Date(box.createdAt).toLocaleDateString()}</p>
                </div>
                {box.caseId && (
                  <Link href={`/dashboard/${userId}/evidence?caseId=${encodeURIComponent(box.caseId)}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    View Evidence <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
