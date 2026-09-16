import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The waitlist endpoint is the only route without a session (CLAUDE.md hard
 * line 4), so it can't be left open to anyone who can type a URL. Instead, the
 * rejected sign-in mints this token: it carries the address Google just
 * verified, it is signed with AUTH_SECRET, and it dies in 15 minutes.
 *
 * The consequence that matters: nobody can add an address to the waiting list
 * without first proving to Google that it's theirs.
 */
export const WAITLIST_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface WaitlistClaim {
  email: string;
  name?: string;
  /** Expiry, epoch milliseconds. */
  expiresAt: number;
}

export function signWaitlistToken(
  claim: Omit<WaitlistClaim, "expiresAt">,
  secret: string,
  now: number = Date.now(),
): string {
  const payload: WaitlistClaim = { ...claim, expiresAt: now + WAITLIST_TOKEN_TTL_MS };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Returns null for anything that isn't a valid, unexpired, correctly signed token. */
export function verifyWaitlistToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): WaitlistClaim | null {
  const separator = token.lastIndexOf(".");
  if (separator === -1) return null;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!encoded || !signature) return null;

  if (!signaturesMatch(signature, sign(encoded, secret))) return null;

  let claim: WaitlistClaim;
  try {
    claim = JSON.parse(base64UrlDecode(encoded)) as WaitlistClaim;
  } catch {
    return null;
  }

  if (typeof claim.email !== "string" || !claim.email) return null;
  if (typeof claim.expiresAt !== "number" || claim.expiresAt <= now) return null;

  return claim;
}

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
