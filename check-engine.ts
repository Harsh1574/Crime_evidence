import "dotenv/config";
import { prisma } from "./src/lib/prisma.js";

try {
    console.log("Checking PostgreSQL connection...");
    const [row] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    console.log(`✅ PostgreSQL: Working (${row.version.split(",")[0]})`);
    await prisma.$disconnect();
    process.exit(0);
} catch (e: any) {
    console.error("❌ PostgreSQL: FAILED. Check DATABASE_URL and that the server is running.");
    console.error(e.message);
    process.exit(1);
}
