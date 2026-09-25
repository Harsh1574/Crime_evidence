/**
 * Create the demo users (one per role). Safe to run repeatedly.
 * Usage: npm run db:seed
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { seedDemoUsers } from "../src/services/seed.js";

const { created, skipped } = await seedDemoUsers();
for (const u of created) console.log(`created  ${u.username.padEnd(12)} role=${u.role.padEnd(17)} password=${u.password}`);
for (const u of skipped) console.log(`exists   ${u}`);
await prisma.$disconnect();
