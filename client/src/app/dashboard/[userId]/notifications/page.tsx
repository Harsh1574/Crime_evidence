"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Bell, CheckCheck, Loader2, Info, AlertTriangle, ShieldCheck, ArrowRightLeft, XCircle, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import LottieLoader from "@/components/ui/LottieLoader";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: string;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  access_request: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  access_request_reviewed: <ShieldCheck className="h-4 w-4 text-green-400" />,
  transfer_request: <ArrowRightLeft className="h-4 w-4 text-amber-400" />,
  transfer_accepted: <ShieldCheck className="h-4 w-4 text-green-400" />,
  transfer_rejected: <XCircle className="h-4 w-4 text-red-400" />,
  disposal_request: <Trash2 className="h-4 w-4 text-amber-400" />,
  disposal_decision: <Trash2 className="h-4 w-4 text-red-400" />,
  case_assignment: <Users className="h-4 w-4 text-blue-400" />,
  case_unassignment: <Users className="h-4 w-4 text-slate-400" />,
  default: <Info className="h-4 w-4 text-blue-400" />,
};

function timeAgo(date: string) {
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function NotificationsPage() {
  const { token } = useAuth();
  const params = useParams();
  const userId = params.userId as string;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const fetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await api.get("/api/v1/notifications");
      setNotifications(r.data.notifications || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  const markAllRead = async () => {
    setMarking(true);
    try {
      await api.put("/api/v1/notifications/read-all");
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) { console.error(e); }
    finally { setMarking(false); }
  };

  const markRead = async (id: string) => {
    try {
      await api.put(`/api/v1/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (e) { console.error(e); }
  };

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Notifications
            {unread > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">{unread}</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{unread} unread</p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all disabled:opacity-50"
          >
            {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><LottieLoader size={120} /></div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-3">
          <Bell className="h-12 w-12 opacity-30" />
          <p className="text-sm">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const icon = TYPE_ICON[n.type] || TYPE_ICON.default;
            const content = (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer hover:border-primary/30 ${n.read ? "border-border bg-card opacity-60" : "border-primary/20 bg-primary/5"
                  }`}
              >
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
              </div>
            );

            return n.link ? (
              <Link href={n.link} key={n.id} onClick={() => !n.read && markRead(n.id)}>
                {content}
              </Link>
            ) : content;
          })}
        </div>
      )}
    </div>
  );
}
