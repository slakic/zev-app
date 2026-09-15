// Real EmailProvider backed by the Mailjet REST API (POST /v3.1/send), selected
// via EMAIL_PROVIDER=mailjet (see .env.example). Requires MAILJET_API_KEY,
// MAILJET_API_SECRET and MAILJET_FROM_EMAIL — checked lazily on first send, not
// at module load, so importing this file stays safe with no config present
// (same reasoning as src/lib/env.ts).
//
// Mailjet doesn't send delivery/seen callbacks without separately configuring
// its Event API (out of scope here, Plans/deployment-portability-plan.md §7.1)
// — unlike MockEmailProvider, a successful send only ever produces a "sent"
// event, never "delivered"/"seen".
import type { EmailProvider, SendResult } from "./providers";

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";

type MailjetMessageResult = {
  Status: "success" | "error";
  To?: { Email: string; MessageID?: number; MessageUUID?: string }[];
  Errors?: { ErrorMessage?: string; ErrorIdentifier?: string }[];
};

type MailjetSendResponse = {
  Messages?: MailjetMessageResult[];
};

export class MailjetEmailProvider implements EmailProvider {
  name = "mailjet";

  async send(msg: { to: string; subject: string; body: string }): Promise<SendResult> {
    const apiKey = process.env.MAILJET_API_KEY;
    const apiSecret = process.env.MAILJET_API_SECRET;
    const fromEmail = process.env.MAILJET_FROM_EMAIL;
    if (!apiKey || !apiSecret || !fromEmail) {
      throw new Error(
        "Mailjet nije konfigurisan: nedostaju MAILJET_API_KEY, MAILJET_API_SECRET ili " +
          "MAILJET_FROM_EMAIL (vidi .env.example)."
      );
    }

    const now = new Date().toISOString();
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    let res: Response;
    try {
      res = await fetch(MAILJET_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: fromEmail },
              To: [{ Email: msg.to }],
              Subject: msg.subject,
              TextPart: msg.body,
            },
          ],
        }),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: `Mrežna greška pri slanju preko Mailjet-a: ${detail}`,
        events: [{ at: now, type: "failed", detail }],
      };
    }

    let payload: MailjetSendResponse | null = null;
    try {
      payload = (await res.json()) as MailjetSendResponse;
    } catch {
      // Non-JSON body (e.g. a gateway error page) — fall through, handled below.
    }

    const result = payload?.Messages?.[0];
    if (res.ok && result?.Status === "success") {
      const messageId = result.To?.[0]?.MessageID != null ? String(result.To[0].MessageID) : undefined;
      return { ok: true, providerMessageId: messageId, events: [{ at: now, type: "sent", detail: "mailjet" }] };
    }

    const errorDetail =
      result?.Errors?.map((e) => e.ErrorMessage).filter(Boolean).join("; ") || `Mailjet HTTP ${res.status}`;
    return { ok: false, error: errorDetail, events: [{ at: now, type: "failed", detail: errorDetail }] };
  }
}
