/**
 * Shared API client.
 *
 * Requests use relative "/api/..." URLs; next.config.ts rewrites them to the
 * backend (http://localhost:3001). The JWT from sessionStorage is attached to
 * every request, and a 401 (expired / revoked token) sends the user back to login.
 */
import axios, { AxiosError } from "axios";

export const api = axios.create();

api.interceptors.request.use((config) => {
    if (typeof window !== "undefined") {
        const token = sessionStorage.getItem("token");
        if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (res) => res,
    (error: AxiosError) => {
        const url = error.config?.url ?? "";
        const isAuthCall = url.includes("/auth/login") || url.includes("/auth/logout");
        if (error.response?.status === 401 && !isAuthCall && typeof window !== "undefined") {
            sessionStorage.removeItem("token");
            sessionStorage.removeItem("user");
            if (!window.location.pathname.startsWith("/login")) {
                // Shown as a toast by the login page after the redirect
                sessionStorage.setItem("flash_message", "Your session expired or was signed out. Please sign in again.");
                window.location.href = "/login";
            }
        }
        return Promise.reject(error);
    }
);

/** Human-readable message from an API error */
export function apiError(err: unknown, fallback = "Request failed"): string {
    const e = err as AxiosError<{ error?: string; details?: string }>;
    return e?.response?.data?.error || e?.message || fallback;
}

/** Download a protected file (auth header required, so a plain <a href> cannot be used) */
export async function downloadFile(url: string, fallbackName: string): Promise<{ sha256?: string; integrity?: string }> {
    const res = await api.get(url, { responseType: "blob" });
    const disposition = (res.headers["content-disposition"] as string | undefined) ?? "";
    const match = /filename\*?="?([^";]+)"?/i.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : fallbackName;

    const href = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);

    return {
        sha256: res.headers["x-file-sha256"] as string | undefined,
        integrity: res.headers["x-file-integrity"] as string | undefined,
    };
}

/** Save a JSON object as a file */
export function saveJson(data: unknown, fileName: string): void {
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export interface UserSummary {
    id: string;
    username: string;
    fullName: string;
    role: string;
    department?: string | null;
}

export const TERMINAL_STATUSES = ["Disposed", "Destroyed", "Released"];

/** Status transitions accepted by the backend (mirrors VALID_STATUS_TRANSITIONS) */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
    Collected: ["Processing", "Analyzed", "Archived", "Destroyed"],
    Processing: ["Analyzed", "Archived"],
    Analyzed: ["Processing", "Presented", "Archived", "Released", "Destroyed"],
    Presented: ["Archived", "Released", "Destroyed"],
    Archived: ["Collected", "Released", "Destroyed"],
    Released: [],
    Disposed: [],
    Destroyed: [],
};

export const ALL_STATUSES = ["Collected", "Processing", "Analyzed", "Presented", "Archived", "Released", "Disposed", "Destroyed"];

/** Badge classes for an evidence status */
export function statusClass(status: string): string {
    switch (status?.toLowerCase()) {
        case "collected": return "border-blue-500/20 bg-blue-500/10 text-blue-400";
        case "processing": return "border-cyan-500/20 bg-cyan-500/10 text-cyan-400";
        case "analyzed": return "border-purple-500/20 bg-purple-500/10 text-purple-400";
        case "presented": return "border-indigo-500/20 bg-indigo-500/10 text-indigo-400";
        case "archived": return "border-slate-500/20 bg-slate-500/10 text-slate-400";
        case "released": return "border-green-500/20 bg-green-500/10 text-green-400";
        case "disposed":
        case "destroyed": return "border-red-500/20 bg-red-500/10 text-red-400";
        default: return "border-border bg-muted text-muted-foreground";
    }
}

export function timeAgo(date: string): string {
    const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}
