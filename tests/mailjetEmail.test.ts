// MailjetEmailProvider contract (Plans/deployment-portability-plan.md §7.1, Faza 3):
// success and error mapped to SendResult, using a mocked HTTP response — no real
// Mailjet account involved.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MailjetEmailProvider } from "@/server/notifications/mailjetEmail";

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("MailjetEmailProvider", () => {
  const saved = {
    MAILJET_API_KEY: process.env.MAILJET_API_KEY,
    MAILJET_API_SECRET: process.env.MAILJET_API_SECRET,
    MAILJET_FROM_EMAIL: process.env.MAILJET_FROM_EMAIL,
  };

  beforeEach(() => {
    process.env.MAILJET_API_KEY = "test-key";
    process.env.MAILJET_API_SECRET = "test-secret";
    process.env.MAILJET_FROM_EMAIL = "noreply@zev.test";
  });

  afterEach(() => {
    process.env.MAILJET_API_KEY = saved.MAILJET_API_KEY;
    process.env.MAILJET_API_SECRET = saved.MAILJET_API_SECRET;
    process.env.MAILJET_FROM_EMAIL = saved.MAILJET_FROM_EMAIL;
    vi.restoreAllMocks();
  });

  it("maps a successful Mailjet response to ok:true with a providerMessageId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse(200, {
        Messages: [{ Status: "success", To: [{ Email: "owner@example.com", MessageID: 123456789 }] }],
      })
    );

    const provider = new MailjetEmailProvider();
    const result = await provider.send({ to: "owner@example.com", subject: "Test", body: "Sadržaj poruke" });

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("123456789");
    expect(result.events.some((e) => e.type === "sent")).toBe(true);
    // Mailjet has no delivery/seen callback without the separately configured Event API.
    expect(result.events.some((e) => e.type === "delivered")).toBe(false);
  });

  it("sends Basic auth built from MAILJET_API_KEY/SECRET and the configured From address", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse(200, { Messages: [{ Status: "success", To: [{ Email: "owner@example.com" }] }] })
    );

    await new MailjetEmailProvider().send({ to: "owner@example.com", subject: "S", body: "B" });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.mailjet.com/v3.1/send");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test-key:test-secret").toString("base64")}`);
    const parsedBody = JSON.parse(init!.body as string);
    expect(parsedBody.Messages[0].From.Email).toBe("noreply@zev.test");
    expect(parsedBody.Messages[0].To[0].Email).toBe("owner@example.com");
  });

  it("maps a Mailjet-level error (2xx HTTP, Status: error) to ok:false with the error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse(200, {
        Messages: [{ Status: "error", Errors: [{ ErrorMessage: "\"nope\" is an invalid recipient." }] }],
      })
    );

    const result = await new MailjetEmailProvider().send({ to: "nope", subject: "Test", body: "B" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid recipient");
    expect(result.events.some((e) => e.type === "failed")).toBe(true);
  });

  it("maps a non-2xx HTTP response to ok:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(401, {}));

    const result = await new MailjetEmailProvider().send({ to: "owner@example.com", subject: "Test", body: "B" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("maps a network failure to ok:false instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.mailjet.com"));

    const result = await new MailjetEmailProvider().send({ to: "owner@example.com", subject: "Test", body: "B" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOTFOUND");
  });

  it("throws a readable error when required config is missing", async () => {
    delete process.env.MAILJET_API_KEY;

    await expect(
      new MailjetEmailProvider().send({ to: "owner@example.com", subject: "Test", body: "B" })
    ).rejects.toThrow(/MAILJET_API_KEY/);
  });
});
