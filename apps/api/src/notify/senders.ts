/**
 * Sending, and nothing else. What to send and whether to send it is decided in
 * `notify.ts`; these two just put it on the wire — or, in stub mode, in a list
 * (CLAUDE.md hard line 7: no real network in tests or CI).
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens Pip: `/rules`, `/week`. */
  url: string;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `gone` means the push service says the subscription no longer exists (404/410). */
export type PushResult = { ok: true } | { ok: false; gone: boolean; detail: string };

export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; detail: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` address or `https:` page a push service can contact. */
  subject: string;
}

type WebPushLike = {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
      TTL: number;
    },
  ): Promise<unknown>;
};

/** A push is worth nothing once it's a day old. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Real web push, straight from Fastify to the browser's push service — no third
 * party in between (the phase brief). `web-push` is loaded only when this is
 * built, so stub mode never pulls it in.
 */
export function webPushSender(vapid: VapidKeys, library?: WebPushLike): PushSender {
  let loaded: Promise<WebPushLike> | null = library ? Promise.resolve(library) : null;
  const webPush = () =>
    (loaded ??= import("web-push").then((module) => module.default as unknown as WebPushLike));

  return {
    async send(target, message) {
      try {
        await (
          await webPush()
        ).sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          {
            vapidDetails: vapid,
            TTL: PUSH_TTL_SECONDS,
          },
        );
        return { ok: true };
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        return {
          ok: false,
          // 404 and 410: the subscription is gone for good, so its row goes too.
          gone: status === 404 || status === 410,
          detail: pushFailure(error, status),
        };
      }
    },
  };
}

/**
 * Why a push service refused, for the log: its status and the reason it gives
 * ("403 BadJwtToken"), or web-push's own complaint when nothing was sent. Only
 * short word-like codes survive, so nothing key-shaped can reach a log line.
 */
export function pushFailure(error: unknown, status: number | undefined): string {
  const body = (error as { body?: unknown }).body;
  let reason = "";
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { reason?: unknown; message?: unknown };
      reason = String(parsed.reason ?? parsed.message ?? "");
    } catch {
      reason = body;
    }
  } else if (status === undefined) {
    reason = (error as Error).message ?? "";
  }
  const words = reason
    .split(/\s+/)
    .filter((word) => /^([A-Za-z][A-Za-z.'-]{0,30}|\d{1,4})$/.test(word))
    .slice(0, 12)
    .join(" ");
  return [status ?? "error", words].filter(Boolean).join(" ");
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Email through Resend's HTTP API — no SMTP from Render. The key never leaves
 * this call, and bodies are never logged (pino redaction, hard line 6).
 */
export function resendEmailSender(options: {
  apiKey: string;
  from: string;
  fetch?: Fetch;
}): EmailSender {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(message) {
      try {
        const response = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
        });
        if (!response.ok) return { ok: false, detail: `resend ${response.status}` };
        const body = (await response.json()) as { id?: string };
        return { ok: true, id: body.id ?? null };
      } catch (error) {
        return { ok: false, detail: (error as Error).message };
      }
    },
  };
}

export interface RecordedPush extends PushMessage {
  endpoint: string;
}

/** Stub mode: everything is recorded, nothing leaves the process. */
export function stubPushSender(): PushSender & { sent: RecordedPush[]; gone: Set<string> } {
  const sent: RecordedPush[] = [];
  const gone = new Set<string>();
  return {
    sent,
    gone,
    async send(target, message) {
      if (gone.has(target.endpoint)) {
        return { ok: false, gone: true, detail: "stub: subscription gone" };
      }
      sent.push({ ...message, endpoint: target.endpoint });
      return { ok: true };
    },
  };
}

export function stubEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { ok: true, id: `stub-${sent.length}` };
    },
  };
}
