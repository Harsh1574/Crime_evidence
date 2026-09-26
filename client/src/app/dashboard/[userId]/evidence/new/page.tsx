"use client";

import { useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Save, Loader2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useCrimeBox } from "@/context/CrimeBoxContext";
import { useToast } from "@/components/ui/Toast";

export default function NewEvidencePage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { permission, activeBox } = useCrimeBox();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const userId = params.userId as string;

    // ... permission check ...

    const [files, setFiles] = useState<FileList | null>(null);
    const [cases, setCases] = useState<{ id: string; caseNumber?: string | null; title: string }[]>([]);

    // Cases the user can file evidence under (suggestions when no Crime Box is active)
    useEffect(() => {
        if (activeBox) return;
        api.get("/api/v1/cases").then((r) => setCases(r.data)).catch(() => undefined);
    }, [activeBox]);

    const [formData, setFormData] = useState({
        caseId: activeBox?.caseId || searchParams.get("caseId") || "", // Pre-fill from active box or ?caseId=
        evidenceId: "",
        type: "Physical",
        description: "",
        collectionDate: new Date().toISOString().split("T")[0],
        location: "",
        officerNotes: "",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFiles(e.target.files);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const data = new FormData();
            data.append("caseId", formData.caseId);
            if (formData.evidenceId.trim()) data.append("evidenceId", formData.evidenceId.trim());
            data.append("type", formData.type);
            data.append("description", formData.description);
            data.append("collectionDate", new Date(formData.collectionDate).toISOString());
            data.append("location", formData.location);
            if (formData.officerNotes) data.append("officerNotes", formData.officerNotes);

            if (files) {
                for (let i = 0; i < files.length; i++) {
                    data.append("files", files[i]);
                }
            }

            const response = await api.post("/api/v1/evidence", data, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            if (response.data.success) {
                if (response.data.anchoring?.anchorStatus === "FAILED") {
                    toast.warning(`Anchoring to IPFS/ledger failed: ${response.data.anchoring.error}. Use Retry Anchoring on the evidence page.`, "Evidence saved");
                } else {
                    toast.success(`${response.data.evidence.evidenceNumber} hashed, stored on IPFS and anchored on the ledger.`, "Evidence registered");
                }
                router.push(`/dashboard/${userId}/evidence/${response.data.evidence.id}`);
            }
        } catch (err) {
            setError(apiError(err, "Failed to register evidence."));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link
                    href={`/dashboard/${userId}/evidence`}
                    className="rounded-full p-2 hover:bg-muted text-muted-foreground transition-colors"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Register New Evidence</h1>
                    <p className="text-muted-foreground">Log a new item into the chain of custody.</p>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex justify-between">
                                Case ID
                                {activeBox && <span className="text-xs text-primary font-mono lowercase tracking-wide">(locked to active box)</span>}
                            </label>
                            <input
                                name="caseId"
                                required
                                placeholder="CASE-2024-001"
                                className={cn(
                                    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                                    activeBox && "opacity-70 cursor-not-allowed border-primary/50 text-primary font-bold"
                                )}
                                value={formData.caseId}
                                onChange={handleChange}
                                readOnly={!!activeBox}
                                list="case-options"
                            />
                            <datalist id="case-options">
                                {cases.map((c) => (
                                    <option key={c.id} value={c.caseNumber ?? c.id}>{c.title}</option>
                                ))}
                            </datalist>
                            {!activeBox && cases.length > 0 && (
                                <p className="text-xs text-muted-foreground">Pick one of your cases to attach this item to it.</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">
                                Evidence ID <span className="text-xs text-muted-foreground">(optional — auto-generated)</span>
                            </label>
                            <input
                                name="evidenceId"
                                placeholder="EVID_2026_001"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={formData.evidenceId}
                                onChange={handleChange}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Evidence Type
                            </label>
                            <select
                                name="type"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.type}
                                onChange={handleChange}
                            >
                                <option value="Physical">Physical Object</option>
                                <option value="Digital">Digital File</option>
                                <option value="Testimonial">Document / Transcript</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Collection Date
                            </label>
                            <input
                                type="date"
                                name="collectionDate"
                                required
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.collectionDate}
                                onChange={handleChange}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Location Found
                            </label>
                            <input
                                type="text"
                                name="location"
                                required
                                placeholder="123 Crime Scene Blvd, Room 4"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.location}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Description
                        </label>
                        <textarea
                            name="description"
                            required
                            rows={3}
                            placeholder="Detailed description of the item..."
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={formData.description}
                            onChange={handleChange}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Attachments (Images, Documents)
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="file"
                                multiple
                                onChange={handleFileChange}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground hover:file:cursor-pointer"
                            />
                            <UploadCloud className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Each file is SHA-256 hashed and stored on IPFS; its hash is anchored on the ledger.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Officer Notes (Optional)
                        </label>
                        <textarea
                            name="officerNotes"
                            rows={2}
                            placeholder="Any additional context..."
                            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={formData.officerNotes}
                            onChange={handleChange}
                        />
                    </div>

                    {error && (
                        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className={cn(
                                "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto",
                                loading && "cursor-wait"
                            )}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Registering...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Register Evidence
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
