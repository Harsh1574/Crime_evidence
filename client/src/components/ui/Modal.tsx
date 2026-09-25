"use client";

import { X } from "lucide-react";

export function Modal({
    title,
    description,
    onClose,
    children,
    footer,
    wide = false,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    wide?: boolean;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-foreground">{title}</h3>
                        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
                    </div>
                    <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="mt-4 space-y-4">{children}</div>
                {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
            </div>
        </div>
    );
}

export const inputClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const textareaClass =
    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const primaryBtn =
    "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed";
export const secondaryBtn =
    "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed";
export const dangerBtn =
    "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-destructive/40 text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed";
