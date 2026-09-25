import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const createPrismaClient = () => {
    try {
        // DATABASE_URL format: postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString || !connectionString.startsWith("postgres")) {
            throw new Error(
                "DATABASE_URL must be a PostgreSQL connection string, e.g. postgresql://postgres:postgres@localhost:5432/crime_evidence"
            );
        }

        const safeUrl = connectionString.replace(/\/\/([^:@/]+):[^@]*@/, "//$1:****@");
        console.log(`[Prisma] Connecting to: ${safeUrl}`);

        const adapter = new PrismaPg({ connectionString });

        return new PrismaClient({
            adapter,
            log: process.env.PRISMA_LOG_QUERIES === "true"
                ? ["query", "info", "warn", "error"]
                : ["warn", "error"],
        });
    } catch (err: any) {
        console.error("PRISMA CLIENT FAILURE:");
        console.error(`ERROR_CODE: ${err.code || "UNKNOWN"}`);
        console.error(`MESSAGE: ${err.message}`);

        if (err.message.includes("adapter")) {
            console.error('FIX: Ensure you ran "npx prisma generate" after installing dependencies.');
        }

        process.exit(1); // Stop the server; don't allow a zombie state
    }
};

export const prisma = createPrismaClient();
