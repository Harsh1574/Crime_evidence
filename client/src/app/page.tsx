"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { ArrowRight, Shield, Lock, Activity, FileText, Database, Server } from "lucide-react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import ParticleBackground from "@/components/ui/ParticleBackground";
import SpotlightEffect from "@/components/ui/SpotlightEffect";
import GlitchText from "@/components/ui/GlitchText";
import { FingerprintLogo } from "@/components/ui/FingerprintLogo";

gsap.registerPlugin(ScrollTrigger);

// ── Hero Section ─────────────────────────────────────────────────────────────

function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Intro Animation
      gsap.from(".hero-text-line", {
        y: 100,
        opacity: 0,
        duration: 1.2,
        stagger: 0.2,
        ease: "power4.out",
      });

      gsap.from(".hero-sub", {
        y: 20,
        opacity: 0,
        duration: 1,
        delay: 0.8,
        ease: "power2.out",
      });

      gsap.from(".hero-cta", {
        scale: 0.9,
        opacity: 0,
        duration: 0.8,
        delay: 1,
        ease: "back.out(1.7)",
      });

      // Background Parallax
      gsap.to(".hero-bg-grid", {
        backgroundPosition: "0px 100px",
        ease: "none",
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0 z-0">
        <ParticleBackground />
      </div>

      {/* Background Effects */}
      <div className="absolute inset-0 hero-bg-grid opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(to right, #80808012 1px, transparent 1px), linear-gradient(to bottom, #80808012 1px, transparent 1px)",
          backgroundSize: "40px 40px"
        }}
      />
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-background via-transparent to-background z-10" />

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 blur-[120px] rounded-full sm:opacity-50 opacity-30" />

      {/* Content */}
      <div ref={textRef} className="relative z-20 text-center px-6 max-w-5xl mx-auto">
        <div className="overflow-hidden mb-2">
          <h1 className="hero-text-line text-5xl md:text-8xl font-black tracking-tighter text-foreground">
            <GlitchText text="EVIDENCE." />
          </h1>
        </div>
        <div className="overflow-hidden mb-6">
          <h1 className="hero-text-line text-5xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-primary to-amber-600">
            PROTECTED.
          </h1>
        </div>

        <p className="hero-sub text-lg md:text-2xl text-muted-foreground font-light max-w-2xl mx-auto mb-10 leading-relaxed">
          The next-generation digital chain of custody.
          Immutable logging, real-time analytics, and role-based security.
        </p>

        <div className="hero-cta flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/login" className="px-8 py-4 bg-primary text-primary-foreground text-lg font-bold rounded-full hover:scale-105 hover:shadow-[0_0_30px_-5px_var(--primary)] transition-all duration-300 flex items-center gap-2 group">
            Access System
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link href="/register" className="px-8 py-4 border border-border bg-card/50 backdrop-blur text-foreground text-lg font-medium rounded-full hover:bg-card hover:border-primary/50 transition-all duration-300">
            Request Account
          </Link>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 text-muted-foreground/50 flex flex-col items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, y: [0, 10, 0] }}
        transition={{ delay: 2, duration: 2, repeat: Infinity }}
      >
        <span className="text-xs uppercase tracking-widest">Scroll</span>
        <div className="w-px h-12 bg-gradient-to-b from-primary/0 via-primary/50 to-primary/0" />
      </motion.div>
    </div>
  );
}

// ── Feature Slider ───────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: "Chain of Custody",
    desc: "Every transfer, view, and edit is cryptographically logged.",
    icon: Shield,
    color: "text-amber-400 border-amber-400/20 bg-amber-400/5",
  },
  {
    title: "Secure Boxes",
    desc: "Group evidence cases with public/private key encryption.",
    icon: Database,
    color: "text-blue-400 border-blue-400/20 bg-blue-400/5",
  },
  {
    title: "Real-time Analytics",
    desc: "Live dashboard tracking transfer velocity and case loads.",
    icon: Activity,
    color: "text-green-400 border-green-400/20 bg-green-400/5",
  },
  {
    title: "Digital Vault",
    desc: "Upload physical evidence photos or digital files securely.",
    icon: Server,
    color: "text-purple-400 border-purple-400/20 bg-purple-400/5",
  },
];

function Features() {
  const containerRef = useRef<HTMLDivElement>(null);

  useState(() => {
    // (Optional) GSAP setup for Horizontal scroll if needed
    // For now, simpler grid with hover effects is more reliable for user interaction
  });

  return (
    <div className="py-24 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="mb-16">
        <h2 className="text-3xl md:text-5xl font-bold mb-6">Engineered for Trust.</h2>
        <div className="w-24 h-1 bg-primary mb-6" />
        <p className="text-xl text-muted-foreground max-w-2xl">
          Modern policing demands modern tools. Replace paper trails with unalterable digital proof.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {FEATURES.map((feat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ delay: i * 0.1 }}
            className={`p-8 rounded-2xl border ${feat.color} hover:bg-card hover:border-primary/40 hover:scale-[1.02] transition-all duration-300 group cursor-default`}
          >
            <div className="mb-6 bg-background/50 w-12 h-12 rounded-lg flex items-center justify-center border border-border group-hover:border-primary/50 transition-colors">
              <feat.icon className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-3">{feat.title}</h3>
            <p className="text-muted-foreground leading-relaxed">
              {feat.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Hover Cards ──────────────────────────────────────────────────────────────

function HoverShowcase() {
  const [active, setActive] = useState(0);
  const items = [
    { id: 0, label: "Police", desc: "Collect & Log", grad: "from-blue-600 to-cyan-500", img: "/cards/police.png" },
    { id: 1, label: "Lab Tech", desc: "Analyze & Report", grad: "from-purple-600 to-pink-500", img: "/cards/lab.jpg" },
    { id: 2, label: "Attorney", desc: "Review & Verify", grad: "from-amber-500 to-orange-500", img: "/cards/attorney.webp" },
    { id: 3, label: "Judge", desc: "Audit Trail", grad: "from-emerald-500 to-teal-500", img: "/cards/judge.jpg" },
  ];

  return (
    <div className="py-24 bg-card/30 border-y border-border/50">
      <div className="max-w-7xl mx-auto px-6 text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Unified Workflow</h2>
        <p className="text-muted-foreground">Connecting every stakeholder in the justice system.</p>
      </div>

      <div className="flex flex-col md:flex-row h-[500px] w-full max-w-6xl mx-auto gap-2 px-6">
        {items.map((item) => (
          <motion.div
            key={item.id}
            onHoverStart={() => setActive(item.id)}
            onClick={() => setActive(item.id)}
            layout
            className={cn(
              "relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-500 ease-out border border-white/5",
              active === item.id ? "flex-[3]" : "flex-[1] hover:flex-[1.5]"
            )}
          >
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
              <img src={item.img} alt={item.label} className="w-full h-full object-cover opacity-60 transition-transform duration-700 hover:scale-110" />
            </div>

            {/* Background Gradient */}
            <div className={`absolute inset-0 bg-gradient-to-br ${item.grad} opacity-40 mix-blend-overlay z-10`} />
            <div className={`absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent opacity-90 z-10`} />

            {/* Content */}
            <div className="absolute inset-0 p-6 flex flex-col justify-end">
              <motion.h3
                layout="position"
                className={cn("font-bold uppercase tracking-widest", active === item.id ? "text-2xl mb-2" : "text-lg md:-rotate-90 md:origin-bottom-left md:mb-12")}
              >
                {item.label}
              </motion.h3>
              {active === item.id && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-muted-foreground"
                >
                  {item.desc}
                </motion.p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── CTA Footer ───────────────────────────────────────────────────────────────

function FooterCTA() {
  return (
    <div className="py-32 px-6 text-center">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-black mb-8">Ready to upgrade?</h2>
        <p className="text-xl text-muted-foreground mb-10">
          Join the agencies already securing their chain of custody on BlockEvidence.
        </p>
        <Link
          href="/register"
          className="inline-flex items-center justify-center px-10 py-5 bg-foreground text-background text-xl font-bold rounded-full hover:scale-110 transition-transform duration-300"
        >
          Get Started Now
        </Link>
      </div>
    </div>
  );
}

// ── Main Layout ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user } = useAuth();

  // If already logged in, show different dashboard link? 
  // Maybe just keep standard landing experience.

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Navbar Overlay */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-background/0 backdrop-blur-sm">
        <div className="text-xl font-black tracking-tighter text-foreground flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-primary">
            <FingerprintLogo className="w-8 h-8" />
          </div>
          BlockEvidence
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <Link href={`/dashboard/${user.id}`} className="text-sm font-bold hover:text-primary transition-colors">
              Dashboard
            </Link>
          ) : (
            <Link href="/login" className="text-sm font-bold hover:text-primary transition-colors">
              Login
            </Link>
          )}
        </div>
      </nav>

      <SpotlightEffect />

      <main>
        <Hero />
        <Features />
        <HoverShowcase />
        <FooterCTA />
      </main>

      <footer className="py-8 text-center text-xs text-muted-foreground border-t border-border/30">
        © 2026 BlockEvidence Systems. All rights reserved.
      </footer>
    </div>
  );
}
