// Provider abstraction for e-mail and Viber.
// Ships with MOCK providers for both channels: they mark messages as sent/delivered
// and keep the full history in the NotificationMessage outbox, so every workflow
// that depends on delivery is functional without real credentials. A real e-mail
// provider (Mailjet) is also available — see EMAIL_PROVIDER below.
//
// Select a provider via EMAIL_PROVIDER / VIBER_PROVIDER in .env (see .env.example).
// A real Viber provider isn't implemented yet (Plans/deployment-portability-plan.md §11 P4).

import { MailjetEmailProvider } from "./mailjetEmail";

export type DeliveryEvent = {
  at: string;
  type: "queued" | "sent" | "delivered" | "seen" | "failed" | "retry";
  detail?: string;
};

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  events: DeliveryEvent[];
};

export interface EmailProvider {
  name: string;
  send(msg: { to: string; subject: string; body: string }): Promise<SendResult>;
}

export interface ViberProvider {
  name: string;
  /** Send a direct message to a subscribed Viber user (by subscriber id). */
  sendDirect(msg: { subscriberId: string; text: string }): Promise<SendResult>;
  /** Broadcast to a list of opted-in subscriber ids. */
  broadcast(msg: { subscriberIds: string[]; text: string }): Promise<SendResult[]>;
}

class MockEmailProvider implements EmailProvider {
  name = "mock-email";
  async send(msg: { to: string; subject: string; body: string }): Promise<SendResult> {
    const now = new Date().toISOString();
    void msg;
    return {
      ok: true,
      providerMessageId: `mock-${Math.random().toString(36).slice(2)}`,
      events: [
        { at: now, type: "sent", detail: "mock provider" },
        { at: now, type: "delivered", detail: "simulated delivery callback" },
      ],
    };
  }
}

class MockViberProvider implements ViberProvider {
  name = "mock-viber";
  async sendDirect(msg: { subscriberId: string; text: string }): Promise<SendResult> {
    const now = new Date().toISOString();
    void msg;
    return {
      ok: true,
      providerMessageId: `mock-viber-${Math.random().toString(36).slice(2)}`,
      events: [
        { at: now, type: "sent", detail: "mock provider" },
        { at: now, type: "delivered", detail: "simulated delivery callback" },
        { at: now, type: "seen", detail: "simulated seen callback" },
      ],
    };
  }
  async broadcast(msg: { subscriberIds: string[]; text: string }): Promise<SendResult[]> {
    return Promise.all(msg.subscriberIds.map((subscriberId) => this.sendDirect({ subscriberId, text: msg.text })));
  }
}

export function getEmailProvider(): EmailProvider {
  const kind = process.env.EMAIL_PROVIDER ?? "mock";
  switch (kind) {
    case "mock":
      return new MockEmailProvider();
    case "mailjet":
      return new MailjetEmailProvider();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${kind}. Expected "mock" or "mailjet".`);
  }
}

export function getViberProvider(): ViberProvider {
  const kind = process.env.VIBER_PROVIDER ?? "mock";
  switch (kind) {
    case "mock":
      return new MockViberProvider();
    default:
      // NOTE: the official Viber Bot API can message users who subscribed to
      // the bot; it cannot post into arbitrary private groups.
      throw new Error(`Unknown VIBER_PROVIDER: ${kind}. Only "mock" ships with the MVP.`);
  }
}
