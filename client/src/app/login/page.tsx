"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { api, apiError } from "@/lib/api";
import Link from "next/link";
import { Lock, AlertCircle, Loader2, ShieldCheck, ArrowRight, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import fingerprintAnimation from "../../components/Fingerprint Complete.json";
import ParticleBackground from "@/components/ui/ParticleBackground";
import SpotlightEffect from "@/components/ui/SpotlightEffect";
import gsap from "gsap";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const { login, isAuthenticated, user } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (isAuthenticated && user) {
            router.push(`/dashboard/${user.id}`);
        }
    }, [isAuthenticated, user, router]);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(".gsap-entry", {
                y: 20,
                opacity: 0,
                duration: 0.8,
                stagger: 0.1,
                ease: "power3.out",
                delay: 0.2
            });
        });
        return () => ctx.revert();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const minDelay = new Promise(resolve => setTimeout(resolve, 800));
            const apiCall = api.post("/api/v1/auth/login", { username, password });
            const [response] = await Promise.all([apiCall, minDelay]);

            if (response.data.success) {
                login(response.data.token, response.data.user);
            }
        } catch (err) {
            setError(apiError(err, "Invalid username or password."));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-[#0c0f14] text-white font-sans overflow-hidden">
            {/* Ambient Background */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <ParticleBackground />
            </div>
            <SpotlightEffect />

            {/* Left Section: Form */}
            <motion.div
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:px-20 relative z-10"
            >
                <div className="w-full max-w-md mx-auto space-y-8">
                    {/* Header */}
                    <div className="space-y-3">
                        <h1 className="text-3xl font-bold tracking-tight font-heading gsap-entry">
                            Welcome Back
                        </h1>
                        <p className="text-sm text-[#6b7280] gsap-entry">
                            Sign in to access your evidence dashboard.
                        </p>
                    </div>

                    {/* Form */}
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <div className="gsap-entry">
                                <label className="block text-sm font-medium text-[#9ca3af] mb-1.5">Username</label>
                                <div className="relative group">
                                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#4b5563] transition-colors group-focus-within:text-primary">
                                        <BadgeCheck className="h-[18px] w-[18px]" />
                                    </div>
                                    <input
                                        type="text"
                                        required
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="block w-full bg-[#151921] border border-[#1f2937] rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-[#4b5563] focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-all text-sm outline-none"
                                        placeholder="Enter username"
                                        autoComplete="off"
                                    />
                                </div>
                            </div>

                            <div className="gsap-entry">
                                <label className="block text-sm font-medium text-[#9ca3af] mb-1.5">Password</label>
                                <div className="relative group">
                                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#4b5563] transition-colors group-focus-within:text-primary">
                                        <Lock className="h-[18px] w-[18px]" />
                                    </div>
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="block w-full bg-[#151921] border border-[#1f2937] rounded-lg py-3 pl-10 pr-4 text-white placeholder:text-[#4b5563] focus:border-primary/60 focus:ring-1 focus:ring-primary/40 transition-all text-sm outline-none"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                        </div>

                        <AnimatePresence mode="wait">
                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                >
                                    <div className="flex items-center gap-2.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 text-sm text-red-400">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="gsap-entry">
                            <motion.button
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                type="submit"
                                disabled={loading}
                                className={cn(
                                    "w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed group",
                                    loading && "cursor-wait"
                                )}
                            >
                                <span className="flex items-center justify-center gap-2">
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Signing in...
                                        </>
                                    ) : (
                                        <>
                                            Sign In <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                                        </>
                                    )}
                                </span>
                            </motion.button>
                        </div>
                    </form>

                    <p className="text-center text-sm text-[#6b7280]">
                        Don&apos;t have an account?{" "}
                        <Link href="/register" className="font-semibold text-primary hover:underline">
                            Sign Up
                        </Link>
                    </p>
                </div>
            </motion.div>

            {/* Right Section: Branding + Lottie */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1, delay: 0.2 }}
                className="hidden lg:flex w-[55%] items-center justify-center relative overflow-hidden bg-[#0c0f14]"
            >
                {/* Hex grid background */}
                <svg className="absolute inset-0 w-full h-full opacity-[0.04]">
                    <defs>
                        <pattern id="hexGrid" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(1.2)">
                            <path d="M28 2L54 18V50L28 66L2 50V18L28 2Z" fill="none" stroke="rgba(34,197,94,0.6)" strokeWidth="0.5" />
                            <path d="M28 68L54 84V116L28 132L2 116V84L28 68Z" fill="none" stroke="rgba(34,197,94,0.6)" strokeWidth="0.5" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#hexGrid)" />
                </svg>

                {/* Center glow */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div style={{
                        width: "500px", height: "500px", borderRadius: "50%",
                        background: "radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 65%)",
                        animation: "pulse-glow 5s ease-in-out infinite",
                    }} />
                </div>

                {/* Concentric scanner rings (properly centered) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg width="600" height="600" viewBox="0 0 600 600" style={{ animation: "orbit 60s linear infinite" }}>
                        <circle cx="300" cy="300" r="200" fill="none" stroke="rgba(34,197,94,0.06)" strokeWidth="0.5" />
                        <circle cx="300" cy="300" r="240" fill="none" stroke="rgba(34,197,94,0.08)" strokeWidth="0.5" strokeDasharray="4 8" />
                        <circle cx="300" cy="300" r="280" fill="none" stroke="rgba(34,197,94,0.04)" strokeWidth="0.5" strokeDasharray="2 12" />
                        {/* Network nodes on the rings */}
                        <circle cx="300" cy="60" r="3" fill="rgba(34,197,94,0.5)">
                            <animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="500" cy="300" r="2.5" fill="rgba(34,197,94,0.4)">
                            <animate attributeName="opacity" values="0.2;0.7;0.2" dur="4s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="100" cy="300" r="2" fill="rgba(34,197,94,0.3)">
                            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="420" cy="140" r="2" fill="rgba(34,197,94,0.35)">
                            <animate attributeName="opacity" values="0.2;0.6;0.2" dur="5s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="180" cy="460" r="2.5" fill="rgba(34,197,94,0.3)">
                            <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4.5s" repeatCount="indefinite" />
                        </circle>
                        {/* Connection lines between nodes */}
                        <line x1="300" y1="60" x2="500" y2="300" stroke="rgba(34,197,94,0.06)" strokeWidth="0.5">
                            <animate attributeName="opacity" values="0;0.15;0" dur="6s" repeatCount="indefinite" />
                        </line>
                        <line x1="500" y1="300" x2="420" y2="140" stroke="rgba(34,197,94,0.05)" strokeWidth="0.5">
                            <animate attributeName="opacity" values="0;0.12;0" dur="5s" repeatCount="indefinite" begin="1s" />
                        </line>
                        <line x1="100" y1="300" x2="180" y2="460" stroke="rgba(34,197,94,0.05)" strokeWidth="0.5">
                            <animate attributeName="opacity" values="0;0.12;0" dur="7s" repeatCount="indefinite" begin="2s" />
                        </line>
                        <line x1="300" y1="60" x2="100" y2="300" stroke="rgba(34,197,94,0.04)" strokeWidth="0.5">
                            <animate attributeName="opacity" values="0;0.1;0" dur="8s" repeatCount="indefinite" begin="3s" />
                        </line>
                    </svg>
                </div>

                {/* Second layer — counter-rotating ring */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg width="520" height="520" viewBox="0 0 520 520" style={{ animation: "orbit 45s linear infinite reverse" }}>
                        <circle cx="260" cy="260" r="255" fill="none" stroke="rgba(34,197,94,0.05)" strokeWidth="0.5" strokeDasharray="6 16" />
                        <circle cx="260" cy="5" r="2" fill="rgba(34,197,94,0.5)">
                            <animate attributeName="r" values="1.5;3;1.5" dur="2s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="260" cy="515" r="1.5" fill="rgba(34,197,94,0.35)">
                            <animate attributeName="r" values="1;2.5;1" dur="3s" repeatCount="indefinite" />
                        </circle>
                    </svg>
                </div>

                {/* Content */}
                <div className="relative flex flex-col items-center gap-5 z-10">
                    <motion.h2
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.8, delay: 0.5 }}
                        className="text-4xl font-extrabold tracking-tight font-heading text-white"
                    >
                        BLOCK<span className="text-primary">EVIDENCE</span>
                    </motion.h2>
                    <motion.p
                        initial={{ y: -10, opacity: 0 }}
                        animate={{ y: 0, opacity: 0.5 }}
                        transition={{ duration: 0.8, delay: 0.7 }}
                        className="text-sm text-[#6b7280] tracking-widest uppercase"
                    >
                        Tamper-proof chain of custody
                    </motion.p>

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 1, delay: 0.4 }}
                        className="relative w-[340px] h-[340px] mt-4"
                    >
                        {/* Glowing ring around fingerprint */}
                        <div className="absolute inset-[-12px] rounded-full" style={{
                            border: "1px solid rgba(34,197,94,0.12)",
                            boxShadow: "0 0 40px rgba(34,197,94,0.05), inset 0 0 40px rgba(34,197,94,0.03)",
                            animation: "pulse-glow 4s ease-in-out infinite",
                        }} />

                        <Lottie
                            animationData={fingerprintAnimation}
                            loop={true}
                            className="w-full h-full opacity-85"
                        />

                        {/* Scan line */}
                        <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-full">
                            <div style={{
                                width: "100%", height: "2px",
                                background: "linear-gradient(90deg, transparent 10%, rgba(34,197,94,0.7) 50%, transparent 90%)",
                                boxShadow: "0 0 15px rgba(34,197,94,0.3), 0 2px 30px rgba(34,197,94,0.1)",
                                animation: "scan 4s ease-in-out infinite",
                            }} />
                        </div>
                    </motion.div>

                    {/* Bottom feature badges */}
                    <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.8, delay: 1 }}
                        className="flex gap-6 mt-2"
                    >
                        {["Encrypted", "Immutable", "Verified"].map((label) => (
                            <div key={label} className="flex items-center gap-1.5 text-xs text-[#4b5563]">
                                <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(34,197,94,0.5)", boxShadow: "0 0 6px rgba(34,197,94,0.3)" }} />
                                {label}
                            </div>
                        ))}
                    </motion.div>
                </div>
            </motion.div>
        </div>
    );
}
