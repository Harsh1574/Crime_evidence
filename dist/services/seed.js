/**
 * Demo users — one per role used in the setup/acceptance walkthrough.
 * Idempotent: existing usernames are left untouched.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
export const DEMO_USERS = [
    { username: "admin", password: "admin123", role: "admin", fullName: "System Administrator", email: "admin@crimeevidence.gov", department: "IT Administration", badgeNumber: "ADM-001" },
    { username: "prosecutor", password: "prosecutor123", role: "prosecutor", fullName: "Priya Prosecutor", email: "prosecutor@crimeevidence.gov", department: "Prosecutor's Office", badgeNumber: "PRO-001" },
    { username: "collector", password: "collector123", role: "collector", fullName: "Carl Collector", email: "collector@crimeevidence.gov", department: "Crime Scene Unit", badgeNumber: "COL-001" },
    { username: "analyst", password: "analyst123", role: "forensic_analyst", fullName: "Farah Analyst", email: "analyst@crimeevidence.gov", department: "Forensic Lab", badgeNumber: "FOR-001" },
    { username: "judge", password: "judge123", role: "judge", fullName: "Justice Jagdish", email: "judge@crimeevidence.gov", department: "District Court", badgeNumber: "JDG-001" },
    { username: "auditor", password: "auditor123", role: "auditor", fullName: "Anita Auditor", email: "auditor@crimeevidence.gov", department: "Internal Affairs", badgeNumber: "AUD-001" },
];
export async function seedDemoUsers() {
    const created = [];
    const skipped = [];
    for (const u of DEMO_USERS) {
        const existing = await prisma.user.findFirst({ where: { OR: [{ username: u.username }, { email: u.email }] } });
        if (existing) {
            skipped.push(u.username);
            continue;
        }
        await prisma.user.create({
            data: {
                username: u.username,
                email: u.email,
                fullName: u.fullName,
                role: u.role,
                department: u.department,
                badgeNumber: u.badgeNumber,
                passwordHash: await bcrypt.hash(u.password, 12),
            },
        });
        created.push({ username: u.username, role: u.role, password: u.password });
    }
    return { created, skipped };
}
//# sourceMappingURL=seed.js.map