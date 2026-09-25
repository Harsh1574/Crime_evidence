"use client";

import { useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import {
    ArrowRightLeft,
    CheckCircle2,
    XCircle,
    Clock,
    User,
    Loader2
} from "lucide-react";
import { useParams } from "next/navigation";

export default function CustodyDashboardPage() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [incoming, setIncoming] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [outgoing, setOutgoing] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const params = useParams();
    const userId = params.userId as string;
    const { user, can } = useAuth();

    const fetchTransfers = async () => {
        try {
            const response = await api.get("/api/v1/custody/pending");
            setIncoming(response.data.incoming);
            setOutgoing(response.data.outgoing);
        } catch (err) {
            console.error("Failed to fetch transfers", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTransfers();
    }, []);

    const handleApprove = async (transferId: string) => {
        if (!confirm("Confirm receipt of this evidence? This will digitally sign the transfer and make you the custodian.")) return;
        setActionLoading(transferId);
        try {
            // Receipt signature: SHA-256 of who accepted what and when (the server chains it to the custody history)
            const payload = `${transferId}|${user?.id}|${new Date().toISOString()}`;
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
            const signature = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
            await api.post(`/api/v1/custody/transfer/${transferId}/approve`, { signature });
            await fetchTransfers(); // Refresh list
            alert("Transfer accepted. You are now the custodian.");
        } catch (error: unknown) {
            alert(apiError(error, "Failed to accept transfer."));
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (transferId: string) => {
        const reason = prompt("Enter a note explaining the rejection:");
        if (!reason) return;

        setActionLoading(transferId);
        try {
            await api.post(`/api/v1/custody/transfer/${transferId}/reject`, { reason });
            await fetchTransfers();
            alert("Transfer rejected. Custody stays with the sender.");
        } catch (error: unknown) {
            alert(apiError(error, "Failed to reject transfer."));
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Chain of Custody Dashboard</h1>
                <p className="text-muted-foreground">Manage pending transfers and view active requests.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                {/* Incoming Section */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="bg-blue-500/10 p-2 rounded-full">
                            <ArrowRightLeft className="h-5 w-5 text-blue-500" />
                        </div>
                        <h2 className="text-xl font-semibold">Incoming Requests</h2>
                        <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {incoming.length}
                        </span>
                    </div>

                    {incoming.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                            No incoming transfer requests.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {incoming.map((transfer) => (
                                <div key={transfer.id} className="rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="space-y-1">
                                            <Link href={`/dashboard/${userId}/evidence/${transfer.evidence.id}`} className="font-semibold hover:underline flex items-center gap-2">
                                                {transfer.evidence.evidenceNumber ?? transfer.evidence.caseId}
                                                <span className="text-xs font-normal text-muted-foreground border border-border px-1.5 py-0.5 rounded">
                                                    {transfer.evidence.type}
                                                </span>
                                            </Link>
                                            <p className="text-sm text-muted-foreground line-clamp-1">{transfer.evidence.description}</p>
                                        </div>
                                        <Clock className="h-4 w-4 text-yellow-500" />
                                    </div>

                                    <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4 bg-muted/50 p-2 rounded-md">
                                        <User className="h-4 w-4" />
                                        <span>Sender: <span className="text-foreground font-medium">{transfer.fromUser.fullName}</span></span>
                                    </div>

                                    <p className="text-xs text-muted-foreground italic mb-4">&quot;{transfer.reason}&quot;</p>

                                    {can("accept_transfers") ? (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleApprove(transfer.id)}
                                            disabled={actionLoading === transfer.id}
                                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {actionLoading === transfer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                            Accept
                                        </button>
                                        <button
                                            onClick={() => handleReject(transfer.id)}
                                            disabled={actionLoading === transfer.id}
                                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 disabled:opacity-50"
                                        >
                                            <XCircle className="h-4 w-4" />
                                            Reject
                                        </button>
                                    </div>
                                    ) : (
                                        <p className="text-xs text-amber-400">Your role cannot accept custody transfers.</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Outgoing Section */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="bg-yellow-500/10 p-2 rounded-full">
                            <Clock className="h-5 w-5 text-yellow-500" />
                        </div>
                        <h2 className="text-xl font-semibold">My Requests</h2>
                        <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {outgoing.length}
                        </span>
                    </div>

                    {outgoing.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                            No active outgoing requests.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {outgoing.map((transfer) => (
                                <div key={transfer.id} className="rounded-lg border border-border bg-card p-4 shadow-sm opacity-75 hover:opacity-100 transition-opacity">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="space-y-1">
                                            <Link href={`/dashboard/${userId}/evidence/${transfer.evidence.id}`} className="font-semibold hover:underline">
                                                {transfer.evidence.evidenceNumber ?? transfer.evidence.caseId}
                                            </Link>
                                            <p className="text-sm text-muted-foreground line-clamp-1">{transfer.evidence.description}</p>
                                        </div>
                                        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-500">
                                            Pending
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                                        <User className="h-4 w-4" />
                                        <span>Recipient: <span className="text-foreground font-medium">{transfer.toUser.fullName}</span></span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
