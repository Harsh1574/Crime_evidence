"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Rss, Loader2, RefreshCw } from "lucide-react";
import LottieLoader from "@/components/ui/LottieLoader";

interface ActivityEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  createdAt: string;
  actor: { id: string; username: string; fullName: string; role: string };
}

const ACTION_STYLES: Record<string, { label: string; color: string; dot: string }> = {
  commented: { label: "commented on", color: "text-blue-400", dot: "bg-blue-400" },
  submitted_lab_result: { label: "submitted lab result for", color: "text-purple-400", dot: "bg-purple-400" },
  created_case: { label: "created case", color: "text-primary", dot: "bg-primary" },
  register: { label: "registered", color: "text-green-400", dot: "bg-green-400" },
  registered_evidence: { label: "registered evidence", color: "text-green-400", dot: "bg-green-400" },
  updated_evidence: { label: "updated evidence", color: "text-blue-400", dot: "bg-blue-400" },
  changed_evidence_status: { label: "changed status of", color: "text-cyan-400", dot: "bg-cyan-400" },
  requested_transfer: { label: "requested a transfer of", color: "text-amber-400", dot: "bg-amber-400" },
  accepted_transfer: { label: "accepted custody of", color: "text-green-400", dot: "bg-green-400" },
  rejected_transfer: { label: "rejected a transfer of", color: "text-red-400", dot: "bg-red-400" },
  requested_disposal: { label: "requested disposal of", color: "text-amber-400", dot: "bg-amber-400" },
  approved_disposal: { label: "approved disposal of", color: "text-red-400", dot: "bg-red-400" },
  rejected_disposal: { label: "rejected disposal of", color: "text-green-400", dot: "bg-green-400" },
  verified_integrity: { label: "verified integrity →", color: "text-primary", dot: "bg-primary" },
  generated_report: { label: "generated report", color: "text-purple-400", dot: "bg-purple-400" },
  updated_case: { label: "updated case", color: "text-blue-400", dot: "bg-blue-400" },
  added_case_officer: { label: "added case officer", color: "text-blue-400", dot: "bg-blue-400" },
  removed_case_officer: { label: "removed case officer", color: "text-slate-400", dot: "bg-slate-400" },
  archived_evidence: { label: "archived", color: "text-slate-400", dot: "bg-slate-400" },
  restored_evidence: { label: "restored", color: "text-blue-400", dot: "bg-blue-400" },
  access: { label: "accessed", color: "text-amber-400", dot: "bg-amber-400" },
};

function timeAgo(date: string) {
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function ActivityFeedPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<ActivityEntry[]>([]);
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchActivity = useCallback(async (p = 1) => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await api.get("/api/v1/activity", { params: { page: p, limit: 20, mine: mine ? "true" : undefined } });
      setLogs(r.data.logs || []);
      setTotalPages(r.data.totalPages || 1);
      setPage(p);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [token, mine]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Rss className="h-6 w-6 text-primary" /> Activity Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time system-wide activity log</p>
        </div>
        <div className="flex gap-2">
        <button
          onClick={() => setMine(m => !m)}
          className={`px-3 py-2 rounded-lg border text-sm transition-all ${mine ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {mine ? "Showing my actions" : "Only my actions"}
        </button>
        <button
          onClick={() => fetchActivity(page)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <LottieLoader size={120} />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-56 text-muted-foreground space-y-3">
          <Rss className="h-12 w-12 opacity-30" />
          <p className="text-sm">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-1 pl-12">
            {logs.map((log, i) => {
              const style = ACTION_STYLES[log.action] || { label: log.action.replace(/_/g, " "), color: "text-muted-foreground", dot: "bg-muted-foreground" };
              return (
                <div key={log.id} className="relative group">
                  {/* Dot */}
                  <span className={`absolute -left-[34px] top-3.5 w-2.5 h-2.5 rounded-full border-2 border-background ${style.dot}`} />
                  <div className="py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{log.actor.fullName}</span>
                      <span className={`text-sm ${style.color}`}>{style.label}</span>
                      <span className="text-sm text-foreground font-medium">{log.entityLabel || log.entityType}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">{timeAgo(log.createdAt)}</span>
                      <span className="text-xs text-muted-foreground/50">·</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{log.actor.role}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            disabled={page <= 1}
            onClick={() => fetchActivity(page - 1)}
            className="px-3 py-1 rounded-lg border border-border text-sm text-muted-foreground disabled:opacity-40 hover:text-foreground"
          >Prev</button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => fetchActivity(page + 1)}
            className="px-3 py-1 rounded-lg border border-border text-sm text-muted-foreground disabled:opacity-40 hover:text-foreground"
          >Next</button>
        </div>
      )}
    </div>
  );
}
