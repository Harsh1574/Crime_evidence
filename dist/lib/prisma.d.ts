import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export declare const prisma: PrismaClient<{
    adapter: PrismaPg;
    log: ("error" | "info" | "query" | "warn")[];
}, "error" | "info" | "query" | "warn", import("@prisma/client/runtime/client").DefaultArgs>;
//# sourceMappingURL=prisma.d.ts.map