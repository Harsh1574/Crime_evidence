"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
    LayoutDashboard,
    FileText,
    Activity,
    LogOut,
    User,
    Menu,
    X,
    FolderOpen,
    BarChart2,
    Bell,
    Rss,
    Trash2,
    ScrollText,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FingerprintLogo } from "@/components/ui/FingerprintLogo";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isAuthenticated, isLoading, logout, canAny, can } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const params = useParams();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [signingOut, setSigningOut] = useState(false);
    const userId = params.userId as string;

    // Unread notification badge — refreshed on navigation and every 30 seconds
    useEffect(() => {
        if (!isAuthenticated) return;
        const load = () => api.get("/api/v1/notifications").then((r) => setUnread(r.data.unreadCount ?? 0)).catch(() => undefined);
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
    }, [isAuthenticated, pathname]);

    const handleSignOut = async () => {
        setSigningOut(true);
        await logout();
        setSigningOut(false);
    };

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isLoading, isAuthenticated, router]);

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                Loading...
            </div>
        );
    }

    if (!isAuthenticated) return null;

    const navigation = [
        { name: "Dashboard", href: `/dashboard/${userId}`, icon: LayoutDashboard },
        { name: "Evidence", href: `/dashboard/${userId}/evidence`, icon: FileText },
        { name: "Cases", href: `/dashboard/${userId}/cases`, icon: FolderOpen },
        { name: "Chain of Custody", href: `/dashboard/${userId}/custody`, icon: Activity },
        { name: "Analytics", href: `/dashboard/${userId}/analytics`, icon: BarChart2 },
        { name: "Activity Feed", href: `/dashboard/${userId}/activity`, icon: Rss },
        { name: "Notifications", href: `/dashboard/${userId}/notifications`, icon: Bell, badge: unread },
        ...(canAny("approve_disposal", "request_disposal", "view_all_evidence")
            ? [{ name: "Disposals", href: `/dashboard/${userId}/disposals`, icon: Trash2 }]
            : []),
        ...(can("view_audit_log")
            ? [{ name: "Audit Log", href: `/dashboard/${userId}/audit-log`, icon: ScrollText }]
            : []),
    ] as { name: string; href: string; icon: typeof LayoutDashboard; badge?: number }[];

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 w-64 transform border-r border-border bg-card transition-transform duration-300 lg:static lg:translate-x-0",
                    sidebarOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="flex h-16 items-center justify-between px-6 border-b border-border">
                    <Link href={`/dashboard/${userId}`} className="flex items-center gap-2">
                        <FingerprintLogo className="h-8 w-8 text-primary" />
                        <span className="text-lg font-bold text-primary">BlockEvidence</span>
                    </Link>
                    <button
                        className="lg:hidden text-muted-foreground hover:text-primary"
                        onClick={() => setSidebarOpen(false)}
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <nav className="flex-1 space-y-1 px-4 py-6">
                    {navigation.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={cn(
                                    "group flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                <item.icon
                                    className={cn(
                                        "h-5 w-5 transition-colors",
                                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-white"
                                    )}
                                />
                                {item.name}
                                {!!item.badge && (
                                    <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>


                <div className="p-4 border-t border-border mt-auto">
                    <div className="mb-4">
                        <div className="flex items-center gap-3 px-2 py-2">
                            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-primary font-bold border border-border">
                                {user?.fullName?.charAt(0) || "U"}
                            </div>
                            <div className="overflow-hidden">
                                <p className="truncate text-sm font-medium text-foreground">{user?.fullName}</p>
                                <p className="truncate text-xs text-muted-foreground">{user?.roleDisplayName ?? user?.role}</p>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex w-full items-center gap-3 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <LogOut className="h-4 w-4" />
                        {signingOut ? "Signing out..." : "Sign Out"}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
                    <button
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground hidden sm:inline-block">
                            {user?.fullName}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                            {user?.roleDisplayName ?? user?.role?.replace(/_/g, " ")}
                        </span>
                        {user?.readOnly && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Read-only
                            </span>
                        )}
                        <Link href={`/dashboard/${userId}/notifications`} className="relative p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                            <Bell className="h-5 w-5" />
                            {unread > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-primary px-1 text-center text-[10px] font-bold text-primary-foreground">
                                    {unread}
                                </span>
                            )}
                        </Link>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto bg-background p-4 lg:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
