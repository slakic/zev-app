// Unauthenticated health check for container/platform probes
// (Plans/deployment-portability-plan.md §8.2) — checks database reachability with a
// trivial query and reports the app version. Deliberately reveals nothing about the
// connection itself (no host, no error detail) beyond ok/error.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../../package.json";

// No cookies/headers are read here, so without this Next could statically optimize the
// route at build time — a health check must re-run its DB query on every request.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "error", version: pkg.version }, { status: 503 });
  }
  return NextResponse.json({ status: "ok", version: pkg.version });
}
