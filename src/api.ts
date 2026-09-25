/**
 * Express REST API layer for the Crime Evidence Management System.
 *
 * Provides HTTP endpoints that read/write the same `demo_config.json`
 * used by the MCP server. This allows the frontend (and other HTTP
 * consumers) to access and mutate the configuration at runtime.
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { readConfig, writeConfig } from "./server.js";
import authRoutes from "./routes/auth.js";
import evidenceRoutes from "./routes/evidence.js";
import custodyRoutes from "./routes/custody.js";
import boxRoutes from "./routes/boxes.js";
import statRoutes from "./routes/stats.js";
import caseRoutes from "./routes/cases.js";
import evidenceExtrasRouter from "./routes/evidence-extras.js";
import extrasRouter from "./routes/extras.js";
import auditLogRoutes from "./routes/audit-log.js";
import disposalRoutes from "./routes/disposals.js";
import ledgerEvidenceRoutes from "./routes/ledger-evidence.js";
import { auditTrail } from "./services/audit.js";
import { getIpfsMode } from "./services/ipfs.js";
import { getLedgerMode } from "./services/ledger.js";
import { prisma } from "./lib/prisma.js";

// ---------------------------------------------------------------------------
// Create Express app
// ---------------------------------------------------------------------------

export function createApp(): express.Express {
    const app = express();

    // Middleware
    app.use(cors({ exposedHeaders: ["Content-Disposition", "X-File-SHA256", "X-File-Integrity"] }));
    app.use(express.json({ limit: "25mb" }));
    app.use(auditTrail);

    // -------------------------------------------------------------------------
    // GET /api/health — server health check
    // -------------------------------------------------------------------------
    app.get("/api/health", async (_req: Request, res: Response) => {
        let database = "ok";
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch {
            database = "unreachable";
        }
        res.status(database === "ok" ? 200 : 503).json({
            status: database === "ok" ? "ok" : "degraded",
            server: "crime-evidence-mcp-server",
            database,
            ledgerMode: getLedgerMode(),
            ipfsMode: getIpfsMode(),
            timestamp: new Date().toISOString(),
        });
    });

    // -------------------------------------------------------------------------
    // GET /api/config — full configuration
    // -------------------------------------------------------------------------
    app.get("/api/config", (_req: Request, res: Response) => {
        try {
            const config = readConfig();
            res.json(config);
        } catch (err: any) {
            res.status(500).json({ error: "Failed to read configuration", details: err.message });
        }
    });

    // -------------------------------------------------------------------------
    // GET /api/config/:section — specific section
    // -------------------------------------------------------------------------
    app.get("/api/config/:section", (req: Request, res: Response) => {
        try {
            const config = readConfig();
            const section = req.params.section as string;

            if (!(section in config)) {
                res.status(404).json({
                    error: `Section "${section}" not found`,
                    available_sections: Object.keys(config),
                });
                return;
            }

            res.json({ section, data: config[section] });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to read configuration", details: err.message });
        }
    });

    // -------------------------------------------------------------------------
    // PUT /api/config — update a config value
    // Body: { section: string, key: string, value: any }
    // -------------------------------------------------------------------------
    app.put("/api/config", (req: Request, res: Response) => {
        try {
            const { section, key, value } = req.body;

            if (!section || !key || value === undefined) {
                res.status(400).json({
                    error: "Missing required fields",
                    required: { section: "string", key: "string", value: "any" },
                });
                return;
            }

            const config = readConfig();

            if (!(section in config)) {
                res.status(404).json({
                    error: `Section "${section}" not found`,
                    available_sections: Object.keys(config),
                });
                return;
            }

            const sectionData = config[section];

            if (Array.isArray(sectionData)) {
                res.status(400).json({
                    error: `Section "${section}" is an array and cannot be updated with key-value pairs directly`,
                });
                return;
            }

            const oldValue = sectionData[key];
            sectionData[key] = value;
            config[section] = sectionData;
            writeConfig(config);

            res.json({
                success: true,
                section,
                key,
                old_value: oldValue,
                new_value: value,
            });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to update configuration", details: err.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /api/config/sections — add a dynamic section
    // Body: { section_name: string, schema: object, overwrite?: boolean }
    // -------------------------------------------------------------------------
    app.post("/api/config/sections", (req: Request, res: Response) => {
        try {
            const { section_name, schema, overwrite = false } = req.body;

            if (!section_name || !schema || typeof schema !== "object") {
                res.status(400).json({
                    error: "Missing required fields",
                    required: {
                        section_name: "string",
                        schema: "object",
                        overwrite: "boolean (optional, default: false)",
                    },
                });
                return;
            }

            const config = readConfig();

            if (!config.dynamic_sections) {
                config.dynamic_sections = {};
            }

            if (config.dynamic_sections[section_name] && !overwrite) {
                res.status(409).json({
                    error: `Dynamic section "${section_name}" already exists. Set overwrite=true to replace.`,
                    existing: config.dynamic_sections[section_name],
                });
                return;
            }

            config.dynamic_sections[section_name] = schema;
            writeConfig(config);

            res.status(201).json({
                success: true,
                section_name,
                schema,
                message: `Dynamic section "${section_name}" added successfully`,
            });
        } catch (err: any) {
            res.status(500).json({ error: "Failed to add dynamic section", details: err.message });
        }
    });

    // -------------------------------------------------------------------------
    // Ledger-style evidence API (IPFS metadata + Fabric CID pointer).
    // Paths it does not define (e.g. /api/evidence/:id/versions) fall through
    // to the v1 routers mounted under /api below.
    // -------------------------------------------------------------------------
    app.use("/api/evidence", ledgerEvidenceRoutes);

    // -------------------------------------------------------------------------
    // Mount Phase 2 route modules — served under /api/v1 (used by the frontend)
    // and under /api (e.g. GET /api/auth/me).
    // -------------------------------------------------------------------------
    for (const prefix of ["/api/v1", "/api"]) {
        app.use(`${prefix}/auth`, authRoutes);
        app.use(`${prefix}/evidence`, evidenceRoutes);
        app.use(`${prefix}/evidence/:evidenceId`, evidenceExtrasRouter);
        app.use(`${prefix}/custody`, custodyRoutes);
        app.use(`${prefix}/boxes`, boxRoutes);
        app.use(`${prefix}/stats`, statRoutes);
        app.use(`${prefix}/cases`, caseRoutes);
        app.use(`${prefix}/audit-log`, auditLogRoutes);
        app.use(`${prefix}/disposals`, disposalRoutes);
        app.use(prefix, extrasRouter);
    }

    // -------------------------------------------------------------------------
    // Global error handler
    // -------------------------------------------------------------------------
    app.use((err: any, _req: Request, res: Response, _next: any) => {
        if (err?.type === "entity.parse.failed") {
            res.status(400).json({ error: "Malformed JSON body" });
            return;
        }
        if (err?.code === "LIMIT_FILE_SIZE") {
            res.status(413).json({ error: "File is larger than the configured storage.max_file_size_mb" });
            return;
        }
        console.error("Unhandled error:", err);
        res.status(500).json({ error: "Internal server error" });
    });

    return app;
}

// ---------------------------------------------------------------------------
// Start Express server
// ---------------------------------------------------------------------------

export function startApiServer(port: number = 3000): void {
    const app = createApp();
    app.listen(port, () => {
        console.log(`Crime Evidence REST API running on http://localhost:${port}`);
        console.log(`  Health:  GET  http://localhost:${port}/api/health`);
        console.log(`  Config:  GET  http://localhost:${port}/api/config`);
        console.log(`  Update:  PUT  http://localhost:${port}/api/config`);
        console.log(`  Add:     POST http://localhost:${port}/api/config/sections`);
        console.log(`  Ledger mode: ${getLedgerMode()}   IPFS mode: ${getIpfsMode()}`);
    });
}
