import { describe, expect, it } from "vitest";
import { pushFailure, webPushSender } from "./senders.js";

/**
 * Why a push didn't go, as the log will say it. A push service's refusal is the
 * only clue when a phone stops hearing from Pip (found 2026-09-21: Monday's push
 * failed and the log had nothing), so it has to be there — and only as a short
 * code, never anything that could be a key.
 */
describe("why a push failed", () => {
  it("gives Apple's status and reason", () => {
    const error = Object.assign(new Error("Received unexpected response code"), {
      statusCode: 403,
      body: JSON.stringify({ reason: "BadJwtToken" }),
    });
    expect(pushFailure(error, 403)).toBe("403 BadJwtToken");
  });

  it("gives Google's plain-text reason", () => {
    const error = Object.assign(new Error("x"), { statusCode: 400, body: "invalid JWT provided" });
    expect(pushFailure(error, 400)).toBe("400 invalid JWT provided");
  });

  it("gives web-push's own complaint when nothing was sent", () => {
    const error = new Error("Vapid private key should be 32 bytes long when decoded.");
    expect(pushFailure(error, undefined)).toBe(
      "error Vapid private key should be 32 bytes long when decoded.",
    );
  });

  it("drops anything key-shaped", () => {
    const error = Object.assign(new Error("x"), {
      statusCode: 401,
      body: "token eyJhbGciOiJFUzI1NiJ9.eyJhdWQiOi.sig BPublicKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/xyz==",
    });
    expect(pushFailure(error, 401)).toBe("401 token");
  });

  it("is what the sender reports", async () => {
    const sender = webPushSender(
      { publicKey: "p", privateKey: "s", subject: "https://pip.example.com" },
      {
        async sendNotification() {
          throw Object.assign(new Error("x"), {
            statusCode: 403,
            body: '{"reason":"BadJwtToken"}',
          });
        },
      },
    );
    const result = await sender.send(
      {
        id: "d",
        endpoint: "https://web.push.apple.com/x",
        p256dh: "k",
        auth: "a",
        label: "iPhone",
      },
      { title: "t", body: "b", url: "/" },
    );
    expect(result).toEqual({ ok: false, gone: false, detail: "403 BadJwtToken" });
  });
});
