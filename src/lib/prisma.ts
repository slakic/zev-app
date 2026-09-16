import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Read directly from process.env, not getEnv() (src/lib/env.ts): this module is evaluated
// at import time (createClient() runs at the bottom of this file, not lazily), which
// includes Next's build-time module graph — getEnv() would trip its
// APP_URL-required-in-production check during the build itself (§13 risk 4), same reasoning
// as next.config.ts.
//
// Omitted (undefined) when DB_POOL_MAX is unset, matching pg's own default (max: 10 per
// Pool instance) exactly — today's behavior on Docker's single long-running instance. Only
// relevant on serverless, where many concurrent instances × an unconfigured 10 each can
// exhaust a database's connection limit (Plans/deployment-portability-plan.md §6).
const dbPoolMax = process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined;

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    ...(dbPoolMax ? { max: dbPoolMax } : {}),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
