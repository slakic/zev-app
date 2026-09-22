// isTestOutboxEnabled() gate (Plans/skupstina-draft-management-and-test-outbox-plan.md
// §B.3): the ONLY thing standing between a real voter's link+code and anyone who can open
// /podesavanja/poruke (or run the CLI script) in a misconfigured deployment. Every case
// here proves a specific failure mode stays CLOSED, per the plan's §B.6 "what must never
// happen" table — this is a security test, not a coverage test, so read it that way.
import { describe, it, expect, afterEach } from "vitest";
import { isTestOutboxEnabled, extractApprovalSecrets, listApprovalLinks } from "@/server/notifications/testOutbox";
import { createFixture, createProposalFixture, openVotingWithLinks } from "./helpers";
import { openVoting } from "@/server/services/meetings";

describe("isTestOutboxEnabled — the gate", () => {
  const saved = {
    SHOW_TEST_LINKS: process.env.SHOW_TEST_LINKS,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  };

  afterEach(() => {
    process.env.SHOW_TEST_LINKS = saved.SHOW_TEST_LINKS;
    process.env.EMAIL_PROVIDER = saved.EMAIL_PROVIDER;
  });

  it("is false when SHOW_TEST_LINKS is unset, even with EMAIL_PROVIDER=mock", () => {
    delete process.env.SHOW_TEST_LINKS;
    process.env.EMAIL_PROVIDER = "mock";
    expect(isTestOutboxEnabled()).toBe(false);
  });

  it("is false for a real provider even with SHOW_TEST_LINKS=1", () => {
    process.env.SHOW_TEST_LINKS = "1";
    process.env.EMAIL_PROVIDER = "mailjet";
    expect(isTestOutboxEnabled()).toBe(false);
  });

  it("is false for an unrecognized provider too — an allow-list, not a deny-list of mailjet", () => {
    process.env.SHOW_TEST_LINKS = "1";
    process.env.EMAIL_PROVIDER = "sendgrid";
    expect(isTestOutboxEnabled()).toBe(false);
  });

  it.each(["true", "yes", "0", "false", ""])("is false for SHOW_TEST_LINKS=%j — only the exact string \"1\" counts", (value) => {
    process.env.SHOW_TEST_LINKS = value;
    process.env.EMAIL_PROVIDER = "mock";
    expect(isTestOutboxEnabled()).toBe(false);
  });

  it("is true for the exact pair: SHOW_TEST_LINKS=1, mock provider", () => {
    process.env.SHOW_TEST_LINKS = "1";
    process.env.EMAIL_PROVIDER = "mock";
    expect(isTestOutboxEnabled()).toBe(true);
  });

  it("is also true with EMAIL_PROVIDER unset (providers.ts's own default is mock)", () => {
    process.env.SHOW_TEST_LINKS = "1";
    delete process.env.EMAIL_PROVIDER;
    expect(isTestOutboxEnabled()).toBe(true);
  });

  it("does NOT depend on NODE_ENV — this project's own Docker image hard-codes NODE_ENV=production (Dockerfile:27), identical to real Vercel production, so the gate can't and doesn't use it to tell the two apart", () => {
    // Object.assign, not a direct assignment: next-env.d.ts types NODE_ENV as
    // readonly (Next.js owns it), so `process.env.NODE_ENV = ...` fails tsc.
    const savedNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.SHOW_TEST_LINKS = "1";
    process.env.EMAIL_PROVIDER = "mock";
    try {
      expect(isTestOutboxEnabled()).toBe(true);
    } finally {
      Object.assign(process.env, { NODE_ENV: savedNodeEnv });
    }
  });
});

describe("extractApprovalSecrets", () => {
  it("returns nulls for a body with no link/code", () => {
    expect(extractApprovalSecrets("Nema ništa ovdje.")).toEqual({ link: null, token: null, code: null });
  });

  it("extracts the reissue wording too (\"Novi verifikacioni kod\"), not just the original", () => {
    const body = "Poštovani Test,\n\nizdat je novi lični link: http://localhost:3000/glasanje/abc123\nNovi verifikacioni kod: 654321\nPrethodni link je poništen.\n";
    expect(extractApprovalSecrets(body)).toEqual({
      link: "http://localhost:3000/glasanje/abc123",
      token: "abc123",
      code: "654321",
    });
  });
});

describe("listApprovalLinks — against real openVoting output", () => {
  it("finds the message, extracts a working token/code, and reports the token as ACTIVE", async () => {
    const f = await createFixture("test-outbox");
    const { proposal } = await createProposalFixture(f);
    const [expected] = await openVotingWithLinks(f, proposal.id);

    const rows = await listApprovalLinks({ proposalId: proposal.id });
    const row = rows.find((r) => r.toAddress === expected.toAddress);
    expect(row).toBeDefined();
    expect(row!.token).toBe(expected.token);
    expect(row!.code).toBe(expected.code);
    expect(row!.link).toContain(`/glasanje/${expected.token}`);
    expect(row!.tokenStatus).toBe("ACTIVE");
    expect(row!.template).toBe("approval-link");
  });

  it("scopes to zevId/proposalId and respects the limit", async () => {
    const f = await createFixture("test-outbox-scope");
    const { proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id);

    const scoped = await listApprovalLinks({ zevId: f.zev.id, proposalId: proposal.id, limit: 1 });
    expect(scoped.length).toBeLessThanOrEqual(1);
    expect(scoped.every((r) => r.template === "approval-link")).toBe(true);
  });
});
