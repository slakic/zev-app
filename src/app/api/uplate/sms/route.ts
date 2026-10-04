// POST /api/uplate/sms — receives a bank SMS forwarded by an iOS Shortcuts automation
// (Plans/bank-sms-ingestion-plan.md). The first route handler in this app that WRITES and is
// called without a login: authentication is the per-ZEV secret in `Authorization: Bearer
// <zevId>.<secret>`, verified inside receiveBankSms().
//
// RULES FOR THIS FILE: never read cookies / getAuthContext() here (the caller is a phone, not a
// browser session), and never take a tenant from anywhere except the verified key. The handler
// only queues the message — nothing is booked until a person confirms it in the app.
import { NextRequest, NextResponse } from "next/server";
import { receiveBankSms } from "@/server/services/bankSms";
import { sha256 } from "@/server/auth/tokens";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let text: unknown = raw; // text/plain fallback: the whole body is the message
  let test = false;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const json = JSON.parse(raw) as { text?: unknown; test?: unknown };
      text = json?.text;
      test = json?.test === true;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
  const result = await receiveBankSms({
    authorization: req.headers.get("authorization"),
    text,
    test,
    ipHash: ip ? sha256(ip) : null,
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}
