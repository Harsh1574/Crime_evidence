"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCrimeBox } from "@/context/CrimeBoxContext";
import CreateCrimeBox from "@/components/crime-box/CreateCrimeBox";
import JoinCrimeBox from "@/components/crime-box/JoinCrimeBox";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Key, Copy, Check, Eye, EyeOff, FilePlus, FolderPlus, Trash2, ScrollText, ArrowRightLeft } from "lucide-react";

// ── Head-Officer-only component to reveal stored box keys ─────────────────────
function ViewBoxKeys({ keys }: { keys: { privateKey: string; publicKey: string } }) {
    const [revealed, setRevealed] = useState(false);
    const [copiedPri, setCopiedPri] = useState(false);
    const [copiedPub, setCopiedPub] = useState(false);

    const copy = (text: string, isPrivate: boolean) => {
        navigator.clipboard.writeText(text);
        if (isPrivate) { setCopiedPri(true); setTimeout(() => setCopiedPri(false), 2000); }
        else { setCopiedPub(true); setTimeout(() => setCopiedPub(false), 2000); }
    };

    return (
        <div className="p-6 rounded-lg border border-amber-500/20 bg-amber-500/5 flex flex-col justify-between">
            <div>
                <h3 className="font-semibold text-amber-600 dark:text-amber-400 text-sm flex items-center gap-2">
                    <Key className="h-4 w-4" /> Box Keys
                </h3>
                <p className="text-xs text-muted-foreground mt-2">Only visible to you. Share with your team.</p>
            </div>
            <div className="mt-4 space-y-3">
                {!revealed ? (
                    <button
                        onClick={() => setRevealed(true)}
                        className="w-full rounded-md flex items-center justify-center gap-2 border border-amber-500/30 text-amber-600 dark:text-amber-400 py-2 text-sm font-medium hover:bg-amber-500/10 transition-colors"
                    >
                        <Eye className="h-4 w-4" /> Show Keys
                    </button>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-foreground w-14 shrink-0">Private</span>
                            <code className="flex-1 rounded-md bg-background px-2 py-1.5 text-xs font-mono border border-border text-foreground truncate">{keys.privateKey}</code>
                            <button onClick={() => copy(keys.privateKey, true)} className="p-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors">
                                {copiedPri ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                            </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground w-14 shrink-0">Public</span>
                            <code className="flex-1 rounded-md bg-background px-2 py-1.5 text-xs font-mono border border-border text-muted-foreground truncate">{keys.publicKey}</code>
                            <button onClick={() => copy(keys.publicKey, false)} className="p-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors">
                                {copiedPub ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                            </button>
                        </div>
                        <button onClick={() => setRevealed(false)} className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground pt-1">
                            <EyeOff className="h-3 w-3" /> Hide
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}


interface DashboardStats {
    totalEvidence: number;
    pendingTransfers: number;
    totalCases: number;
    pendingDisposals: number;
    pendingAccessRequests: number;
    unreadNotifications: number;
}

interface ActivityLog {
    id: string;
    actorName: string;
    action: string;
    entityType: string;
    entityLabel?: string;
}

export default function DashboardPage() {
    const { user, can, canAny } = useAuth();
    const { activeBox, permission, leaveBox } = useCrimeBox();
    const [stats, setStats] = useState<DashboardStats>({
        totalEvidence: 0,
        pendingTransfers: 0,
        totalCases: 0,
        pendingDisposals: 0,
        pendingAccessRequests: 0,
        unreadNotifications: 0,
    });
    const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const params = useParams();
    const userId = params.userId as string;

    useEffect(() => {
        const fetchStats = async () => {
            try {
                // Fetch stats and recent activity in parallel
                const [statsRes, activityRes] = await Promise.all([
                    api.get("/api/v1/stats"),
                    api.get("/api/v1/activity?limit=5"),
                ]);
                setStats(statsRes.data);
                setRecentActivity(activityRes.data.logs || []);
            } catch (error) {
                console.warn("Failed to fetch dashboard data", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (activeBox) {
        // Read stored keys (only available if this user created the box in this session)
        const storedKeysRaw = typeof window !== "undefined"
            ? sessionStorage.getItem("active_crime_box_keys")
            : null;
        const storedKeys: { privateKey: string; publicKey: string } | null = storedKeysRaw
            ? JSON.parse(storedKeysRaw)
            : null;

        return (
            <div className="space-y-6">
                {/* Box Header */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-card p-6">
                    <div>
                        <p className="text-xs text-primary font-medium mb-1">Active Crime Box</p>
                        <h1 className="text-2xl font-bold text-foreground">{activeBox.name}</h1>
                        <p className="text-muted-foreground flex items-center gap-2 mt-1">
                            Case ID: <span className="font-medium text-foreground">{activeBox.caseId}</span>
                            <span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 capitalize">
                                {permission}
                            </span>
                        </p>
                    </div>
                    <button
                        onClick={leaveBox}
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-destructive hover:text-destructive transition-colors"
                    >
                        Leave Box
                    </button>
                </div>

                {/* Action Cards */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {permission === "read-write" && (
                        <div className="p-6 rounded-lg border border-primary/20 bg-primary/5 flex flex-col justify-between">
                            <div>
                                <h3 className="font-semibold text-primary text-sm">Add New Evidence</h3>
                                <p className="text-sm text-muted-foreground mt-2">
                                    Register physical or digital evidence to this case.
                                </p>
                            </div>
                            <Link
                                href={`/dashboard/${userId}/evidence/new`}
                                className="mt-4 block w-full text-center rounded-md bg-primary text-primary-foreground py-2 text-sm font-semibold hover:bg-primary/90 transition-all"
                            >
                                Register Evidence
                            </Link>
                        </div>
                    )}

                    <div className="p-6 rounded-lg border border-border bg-card flex flex-col justify-between">
                        <div>
                            <h3 className="font-medium text-foreground text-sm">View Evidence</h3>
                            <p className="text-sm text-muted-foreground mt-2">
                                Browse all evidence in this box.
                            </p>
                        </div>
                        <Link
                            href={`/dashboard/${userId}/evidence`}
                            className="mt-4 block w-full text-center rounded-md border border-border text-foreground py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            View Evidence →
                        </Link>
                    </div>

                    {/* HEAD OFFICER ONLY: View Box Keys */}
                    {can("create_crime_box") && storedKeys && (
                        <ViewBoxKeys keys={storedKeys} />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                <h1 className="text-2xl font-bold text-foreground">
                    Welcome back, {user?.fullName}
                </h1>
                <p className="text-muted-foreground">
                    Join a Crime Box to access evidence or create a new one.
                </p>
                <div className="mt-2 inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground">
                    Role: {user?.roleDisplayName ?? user?.role?.replace(/_/g, " ")}
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                {/* Left Column: Actions */}
                <div className="space-y-6">
                    {can("create_crime_box") && (
                        <CreateCrimeBox onCreateSuccess={() => router.push(`/dashboard/${userId}/evidence`)} />
                    )}
                    <JoinCrimeBox onJoinSuccess={() => router.push(`/dashboard/${userId}/evidence`)} />
                </div>

                {/* Right Column: Stats & Overview */}
                <div className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2">
                        <Link href={`/dashboard/${userId}/custody`} className="p-6 rounded-xl bg-card border border-border shadow-sm hover:border-primary/30 transition-colors">
                            <h3 className="font-medium text-foreground">Pending Transfers</h3>
                            <p className="text-3xl font-bold text-primary mt-2">
                                {loading ? "..." : stats.pendingTransfers}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Waiting for you to accept</p>
                        </Link>
                        <Link href={`/dashboard/${userId}/evidence`} className="p-6 rounded-xl bg-card border border-border shadow-sm hover:border-primary/30 transition-colors">
                            <h3 className="font-medium text-foreground">Total Evidence</h3>
                            <p className="text-3xl font-bold text-secondary mt-2">
                                {loading ? "..." : stats.totalEvidence}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Visible to you</p>
                        </Link>
                        <Link href={`/dashboard/${userId}/cases`} className="p-6 rounded-xl bg-card border border-border shadow-sm hover:border-primary/30 transition-colors">
                            <h3 className="font-medium text-foreground">Cases</h3>
                            <p className="text-3xl font-bold text-blue-400 mt-2">
                                {loading ? "..." : stats.totalCases}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Created by or assigned to you</p>
                        </Link>
                        <Link href={`/dashboard/${userId}/notifications`} className="p-6 rounded-xl bg-card border border-border shadow-sm hover:border-primary/30 transition-colors">
                            <h3 className="font-medium text-foreground">Unread Notifications</h3>
                            <p className="text-3xl font-bold text-purple-400 mt-2">
                                {loading ? "..." : stats.unreadNotifications}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Transfers, disposals, assignments</p>
                        </Link>
                        {canAny("approve_disposal", "request_disposal") && (
                            <Link href={`/dashboard/${userId}/disposals`} className="p-6 rounded-xl bg-card border border-border shadow-sm hover:border-primary/30 transition-colors">
                                <h3 className="font-medium text-foreground">Pending Disposals</h3>
                                <p className="text-3xl font-bold text-red-400 mt-2">
                                    {loading ? "..." : stats.pendingDisposals}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">{can("approve_disposal") ? "Awaiting your decision" : "Awaiting a judge"}</p>
                            </Link>
                        )}
                    </div>

                    {/* Quick Actions */}
                    <div className="rounded-lg border border-border bg-card p-6">
                        <h3 className="font-medium text-foreground mb-4">Quick Actions</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {can("register_evidence") && (
                                <Link href={`/dashboard/${userId}/evidence/new`} className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted transition-colors">
                                    <FilePlus className="h-4 w-4 text-primary" /> Register Evidence
                                </Link>
                            )}
                            {canAny("create_cases", "register_evidence") && (
                                <Link href={`/dashboard/${userId}/cases?new=1`} className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted transition-colors">
                                    <FolderPlus className="h-4 w-4 text-primary" /> New Case
                                </Link>
                            )}
                            <Link href={`/dashboard/${userId}/custody`} className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted transition-colors">
                                <ArrowRightLeft className="h-4 w-4 text-primary" /> Custody Transfers
                            </Link>
                            {can("approve_disposal") && (
                                <Link href={`/dashboard/${userId}/disposals`} className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted transition-colors">
                                    <Trash2 className="h-4 w-4 text-primary" /> Review Disposals
                                </Link>
                            )}
                            {can("view_audit_log") && (
                                <Link href={`/dashboard/${userId}/audit-log`} className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm hover:bg-muted transition-colors">
                                    <ScrollText className="h-4 w-4 text-primary" /> Audit Log
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="rounded-lg border border-border bg-card p-6">
                        <h3 className="font-medium text-foreground mb-4">Recent Activity</h3>
                        <div className="space-y-4">
                            {recentActivity.length === 0 && !loading ? (
                                <p className="text-sm text-muted-foreground italic">No recent activity.</p>
                            ) : (
                                recentActivity.map((log) => (
                                    <div key={log.id} className="flex items-start gap-3 text-sm">
                                        <div className="mt-0.5 h-2 w-2 rounded-full bg-muted-foreground/50" />
                                        <p className="text-muted-foreground">
                                            <span className="font-medium text-foreground">{log.actorName}</span> {log.action.replace(/_/g, " ")} <span className="font-medium text-foreground">{log.entityLabel || log.entityType}</span>.
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
