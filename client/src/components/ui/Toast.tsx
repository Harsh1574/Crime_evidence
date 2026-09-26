"use client";

/**
 * App-wide toasts and in-app confirm / prompt dialogs
 * (replacements for window.alert, window.confirm and window.prompt).
 *
 *   const toast = useToast();
 *   toast.success("Transfer accepted");
 *   toast.error(apiError(e));
 *   if (!(await toast.confirm({ title: "Delete comment?", danger: true }))) return;
 *   const note = await toast.prompt({ title: "Reject transfer", inputLabel: "Reason", required: true });
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "warning" | "info";

interface ToastItem {
    id: number;
    kind: ToastKind;
    title?: string;
    message: string;
}

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
    inputLabel?: string;
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    multiline?: boolean;
}

interface DialogState extends PromptOptions {
    kind: "confirm" | "prompt";
    resolve: (value: string | boolean | null) => void;
}

interface ToastApi {
    success: (message: string, title?: string) => void;
    error: (message: string, title?: string) => void;
    warning: (message: string, title?: string) => void;
    info: (message: string, title?: string) => void;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    prompt: (options: PromptOptions) => Promise<string | null>;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const DURATION: Record<ToastKind, number> = { success: 4000, info: 4500, warning: 7000, error: 7000 };

const STYLE: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
    success: { icon: CheckCircle2, ring: "border-green-500/40", iconColor: "text-green-400" },
    error: { icon: XCircle, ring: "border-red-500/40", iconColor: "text-red-400" },
    warning: { icon: AlertTriangle, ring: "border-amber-500/40", iconColor: "text-amber-400" },
    info: { icon: Info, ring: "border-blue-500/40", iconColor: "text-blue-400" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const nextId = useRef(1);

    const dismiss = useCallback((id: number) => {
        setToasts((list) => list.filter((t) => t.id !== id));
    }, []);

    const push = useCallback((kind: ToastKind, message: string, title?: string) => {
        const id = nextId.current++;
        setToasts((list) => [...list.slice(-4), { id, kind, message, title }]);
        setTimeout(() => dismiss(id), DURATION[kind]);
    }, [dismiss]);

    const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
        setDialog({ ...options, kind: "confirm", resolve: (v) => resolve(v === true) });
    }), []);

    const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
        setDialog({ ...options, kind: "prompt", resolve: (v) => resolve(typeof v === "string" ? v : null) });
    }), []);

    const api = useRef<ToastApi>({
        success: () => undefined,
        error: () => undefined,
        warning: () => undefined,
        info: () => undefined,
        confirm,
        prompt,
    });
    api.current.success = (m, t) => push("success", m, t);
    api.current.error = (m, t) => push("error", m, t);
    api.current.warning = (m, t) => push("warning", m, t);
    api.current.info = (m, t) => push("info", m, t);
    api.current.confirm = confirm;
    api.current.prompt = prompt;

    const close = (value: string | boolean | null) => {
        dialog?.resolve(value);
        setDialog(null);
    };

    return (
        <ToastContext.Provider value={api.current}>
            {children}

            {/* Toast stack */}
            <div
                aria-live="polite"
                className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
            >
                {toasts.map((t) => {
                    const s = STYLE[t.kind];
                    const Icon = s.icon;
                    return (
                        <div
                            key={t.id}
                            role={t.kind === "error" ? "alert" : "status"}
                            className={cn(
                                "pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-4 text-sm shadow-xl animate-in slide-in-from-bottom-2 fade-in duration-200",
                                s.ring
                            )}
                        >
                            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", s.iconColor)} />
                            <div className="min-w-0 flex-1">
                                {t.title && <p className="font-semibold text-foreground">{t.title}</p>}
                                <p className="text-muted-foreground break-words">{t.message}</p>
                            </div>
                            <button
                                onClick={() => dismiss(t.id)}
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label="Dismiss notification"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    );
                })}
            </div>

            {dialog && <Dialog state={dialog} onClose={close} />}
        </ToastContext.Provider>
    );
}

function Dialog({ state, onClose }: { state: DialogState; onClose: (value: string | boolean | null) => void }) {
    const [value, setValue] = useState(state.defaultValue ?? "");
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const isPrompt = state.kind === "prompt";
    const invalid = isPrompt && state.required && !value.trim();

    useEffect(() => {
        (isPrompt ? inputRef.current : confirmRef.current)?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(isPrompt ? null : false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isPrompt, onClose]);

    const submit = () => {
        if (invalid) return;
        setBusy(true);
        onClose(isPrompt ? value.trim() : true);
    };

    const fieldClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => onClose(isPrompt ? null : false)}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-dialog-title"
                className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 id="app-dialog-title" className="text-lg font-bold text-foreground">{state.title}</h3>
                {state.message && <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>}
                {isPrompt && (
                    <div className="mt-4 space-y-1.5">
                        {state.inputLabel && <label htmlFor="app-dialog-input" className="text-sm font-medium">{state.inputLabel}</label>}
                        {state.multiline ? (
                            <textarea
                                id="app-dialog-input"
                                ref={inputRef}
                                rows={3}
                                className={fieldClass}
                                placeholder={state.placeholder}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                            />
                        ) : (
                            <input
                                id="app-dialog-input"
                                ref={inputRef}
                                className={fieldClass}
                                placeholder={state.placeholder}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && submit()}
                            />
                        )}
                    </div>
                )}
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={() => onClose(isPrompt ? null : false)}
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                    >
                        {state.cancelLabel ?? "Cancel"}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={submit}
                        disabled={invalid || busy}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50",
                            state.danger
                                ? "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {state.confirmLabel ?? "Confirm"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within a ToastProvider");
    return ctx;
}
