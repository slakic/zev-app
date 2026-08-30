import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { sha256 } from "./tokens";
import type { Role, User, Party } from "@/generated/prisma/client";

const COOKIE_NAME = "zev_session";
const SESSION_TTL_HOURS = 12;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export type SessionUser = User & { party: Party | null };

export type AuthContext = {
  userId: string;
  roles: Role[];
  partyId: string | null;
  email: string;
  displayName: string;
  sessionId: string;
};

export async function createSession(userId: string, ip?: string | null, userAgent?: string | null) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      ip: ip ? sha256(ip) : null,
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
  const jwt = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return session;
}

export async function destroySession(): Promise<void> {
  const ctx = await getAuthContext();
  if (ctx) {
    await prisma.session.update({
      where: { id: ctx.sessionId },
      data: { revokedAt: new Date() },
    }).catch(() => {});
  }
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Resolve the authenticated user from the session cookie. Returns null when not logged in. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;
  let sid: string;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    sid = payload.sid as string;
    if (!sid) return null;
  } catch {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: { include: { party: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;
  const u = session.user;
  const displayName = u.party
    ? u.party.kind === "PERSON"
      ? `${u.party.firstName ?? ""} ${u.party.lastName ?? ""}`.trim()
      : u.party.orgName ?? u.email
    : u.email;
  return {
    userId: u.id,
    roles: u.roles,
    partyId: u.partyId,
    email: u.email,
    displayName,
    sessionId: session.id,
  };
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
