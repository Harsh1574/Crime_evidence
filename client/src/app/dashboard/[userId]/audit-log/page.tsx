"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, apiError } from "@/lib/api";
import { inputClass, secondaryBtn } from "@/components/ui/Modal";
import LottieLoader from "@/components/ui/LottieLoader";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  username?: string | null;
  role?: string | null;
  action: string;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

function actionClass(entry: AuditEntry): string {
  if (entry.action.startsWith("ACCESS_") || entry.action === "LOGIN_FAILED") return "text-red-400";
  if (entry.action === "LOGIN" || entry.action === "LOGOUT") return "text-blue-400";
  if ((entry.statusCode ?? 200) >= 400) return "text-amber-400";
  return "text-foreground";
}

export default function AuditLogPage() {
  const { can } = useAuth();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ username: "", action: "", from: "", to: "" });

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await api.get("/api/v1/audit-log", {
        params: {
          page: p,
          limit: 50,
          username: filters.username || undefined,
          action: filters.action || undefined,
          from: filters.from ? new Date(filters.from).toISOString() : undefined,
          to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
        },
      });
      setLogs(r.data.logs);
      setTotalPages(Math.max(1, r.data.totalPages));
      setTotal(r.data.total);
      setPage(p);
      setError("");
    } catch (e) {
      setError(apiError(e, "Failed to load audit log"));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => load(1), 300);
    return () => clearTimeout(timer);
  }, [load]);

  if (!can("view_audit_log")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-3">
        <ShieldAlert className="h-12 w-12 text-red-400" />
        <p>Only administrators and auditors can view the audit log.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-primary" /> Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Logins, logouts, every write and every denied request. {total} entries.</p>
        </div>
        <button onClick={() => load(page)} className={secondaryBtn}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input className={inputClass} placeholder="Username" value={filters.username} onChange={e => setFilters(f => ({ ...f, username: e.target.value }))} />
        <input className={inputClass} placeholder="Action contains (e.g. LOGIN, DENIED, POST)" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} />
        <input className={inputClass} type="date" title="From" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input className={inputClass} type="date" title="To" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
      </div>

      {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex h-40 items-center justify-center"><LottieLoader size={120} /></div>
        ) : logs.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">No entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{l.username ?? "—"} {l.role && <span className="text-xs text-muted-foreground">({l.role})</span>}</td>
                    <td className={cn("px-4 py-2 font-mono text-xs", actionClass(l))}>
                      {l.action}
                      {l.path && !l.action.includes(l.path) && <span className="block text-muted-foreground">{l.method} {l.path}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">{l.statusCode ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.entityType ? `${l.entityType} ${l.entityId?.slice(0, 8) ?? ""}` : "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page} of {totalPages}</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => load(page - 1)} className="px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">Previous</button>
          <button disabled={page >= totalPages} onClick={() => load(page + 1)} className="px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  );
}
