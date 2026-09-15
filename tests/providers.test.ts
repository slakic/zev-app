// getEmailProvider()/getViberProvider() selection switch (Plans/deployment-portability-plan.md
// §7.1, Faza 3): defaults to mock, "mailjet" selects the real provider, anything else throws.
import { describe, it, expect, afterEach } from "vitest";
import { getEmailProvider, getViberProvider } from "@/server/notifications/providers";
import { MailjetEmailProvider } from "@/server/notifications/mailjetEmail";

describe("provider selection", () => {
  const savedEmail = process.env.EMAIL_PROVIDER;
  const savedViber = process.env.VIBER_PROVIDER;

  afterEach(() => {
    process.env.EMAIL_PROVIDER = savedEmail;
    process.env.VIBER_PROVIDER = savedViber;
  });

  it("defaults to the mock e-mail provider when EMAIL_PROVIDER is unset", () => {
    delete process.env.EMAIL_PROVIDER;
    expect(getEmailProvider().name).toBe("mock-email");
  });

  it("selects MailjetEmailProvider for EMAIL_PROVIDER=mailjet", () => {
    process.env.EMAIL_PROVIDER = "mailjet";
    expect(getEmailProvider()).toBeInstanceOf(MailjetEmailProvider);
  });

  it("throws a readable error for an unknown EMAIL_PROVIDER", () => {
    process.env.EMAIL_PROVIDER = "sendgrid";
    expect(() => getEmailProvider()).toThrow(/sendgrid/);
  });

  it("defaults to the mock Viber provider when VIBER_PROVIDER is unset", () => {
    delete process.env.VIBER_PROVIDER;
    expect(getViberProvider().name).toBe("mock-viber");
  });

  it("throws a readable error for an unknown VIBER_PROVIDER", () => {
    process.env.VIBER_PROVIDER = "viber-bot";
    expect(() => getViberProvider()).toThrow(/viber-bot/);
  });
});
