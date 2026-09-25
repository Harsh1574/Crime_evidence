"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FolderOpen, Plus, ChevronRight, Loader2 } from "lucide-react";
import LottieLoader from "@/components/ui/LottieLoader";
import { api, apiError } from "@/lib/api";

interface Case {
  id: string;
  caseNumber?: string | null;
  title: string;
  description?: string;
  status: string;
  createdAt: string;
  createdBy: { fullName: string; username: string };
  crimeBoxes: { id: string; name: string }[];
  officers?: { id: string }[];
  _count?: { evidence: number };
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-green-400 bg-green-400/10 border-green-400/20",
  active: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  closed: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  suspended: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

export default function CasesPage() {
  const { token, canAny } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const userId = params.userId as string;

  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(searchParams.get("new") === "1");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const canCreate = canAny("create_cases", "register_evidence");

  useEffect(() => {
    if (!token) return;
    api.get("/api/v1/cases")
      .then(r => setCases(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const createCase = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const r = await api.post("/api/v1/cases", { title: newTitle, description: newDesc });
      setCases(prev => [r.data, ...prev]);
      setShowNew(false);
      setNewTitle("");
      setNewDesc("");
      alert(`Case created: ${r.data.caseNumber}`);
    } catch (e) { alert(apiError(e, "Failed to create case")); }
    finally { setCreating(false); }
  };

  const visible = cases.filter(c => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [c.title, c.caseNumber ?? "", c.description ?? "", c.status].some(v => v.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" /> Cases
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Cases you created, are assigned to, or hold evidence for</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> New Case
          </button>
        )}
      </div>

      <input
        className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
        placeholder="Filter by case number, title or status…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      {/* New Case Modal */}
      {showNew && canCreate && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">New Case</h2>
            <p className="text-xs text-muted-foreground">A case number (e.g. CASE_2026_001) is assigned automatically.</p>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="Case title *"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
                rows={3}
                placeholder="Description (optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border">Cancel</button>
              <button
                onClick={createCase}
                disabled={creating || !newTitle.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cases List */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <LottieLoader size={120} />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-3">
          <FolderOpen className="h-12 w-12 opacity-30" />
          <p className="text-sm">{cases.length === 0 ? "No cases yet." : "No cases match the filter."}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {visible.map(c => (
            <Link
              key={c.id}
              href={`/dashboard/${userId}/cases/${c.id}`}
              className="group flex items-center justify-between p-5 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  {c.caseNumber && <span className="font-mono text-xs text-primary">{c.caseNumber}</span>}
                  <h3 className="font-semibold text-foreground truncate">{c.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${STATUS_COLORS[c.status] || STATUS_COLORS.open}`}>
                    {c.status}
                  </span>
                </div>
                {c.description && <p className="text-sm text-muted-foreground mt-1 truncate">{c.description}</p>}
                <p className="text-xs text-muted-foreground mt-2">
                  {c._count?.evidence ?? 0} evidence · {c.officers?.length ?? 0} officer{(c.officers?.length ?? 0) !== 1 ? "s" : ""} · {c.crimeBoxes.length} crime box{c.crimeBoxes.length !== 1 ? "es" : ""} · Created by {c.createdBy.fullName} · {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary flex-shrink-0 ml-4 transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
