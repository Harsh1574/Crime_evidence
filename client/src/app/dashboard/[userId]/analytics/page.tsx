"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useParams } from "next/navigation";
import { BarChart2, FileText, Clock, Layers, CheckCircle, AlertCircle, Trash2 } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import LottieLoader from "@/components/ui/LottieLoader";

interface Stats {
  totalEvidence: number;
  pendingTransfers: number;
  totalCases: number;
  totalLabs: number;
  pendingAccessRequests: number;
  pendingDisposals: number;
  unreadNotifications: number;
  evidenceByStatus: { status: string; count: number }[];
  evidenceByType: { type: string; count: number }[];
  evidenceOverTime: { date: string; count: number }[];
}

const PIE_COLORS = ["#22c55e", "#16a34a", "#4ade80", "#86efac", "#bbf7d0"];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-medium">{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const { token } = useAuth();
  const params = useParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.get("/api/v1/stats")
      .then(r => setStats(r.data))
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><LottieLoader size={200} /></div>;
  }

  if (!stats) return <p className="text-muted-foreground text-center mt-12">Failed to load analytics.</p>;

  const summaryCards = [
    { label: "Total Evidence", value: stats.totalEvidence, icon: FileText, color: "text-primary" },
    { label: "Cases", value: stats.totalCases, icon: Layers, color: "text-blue-400" },
    { label: "Pending Transfers", value: stats.pendingTransfers, icon: Clock, color: "text-amber-400" },
    { label: "Pending Access Requests", value: stats.pendingAccessRequests, icon: AlertCircle, color: "text-red-400" },
    { label: "Lab Results", value: stats.totalLabs, icon: CheckCircle, color: "text-green-400" },
    { label: "Pending Disposals", value: stats.pendingDisposals ?? 0, icon: Trash2, color: "text-red-400" },
    { label: "Unread Notifications", value: stats.unreadNotifications, icon: BarChart2, color: "text-purple-400" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <BarChart2 className="h-6 w-6 text-primary" /> Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">System-wide evidence and case statistics</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {summaryCards.map(c => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-5 space-y-2">
            <div className="flex items-center gap-2">
              <c.icon className={`h-4 w-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground font-medium">{c.label}</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Evidence Over Time */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Evidence Submitted — Last 7 Days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={stats.evidenceOverTime || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} name="Submitted" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* By Type */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Evidence by Type</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.evidenceByType || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="type" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} name="Count" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Status (Pie) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Evidence by Status</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={stats.evidenceByStatus || []} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ status, percent }: any) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {(stats.evidenceByStatus || []).map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
