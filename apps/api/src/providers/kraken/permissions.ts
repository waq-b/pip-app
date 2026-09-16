/**
 * What a Kraken key may and must be able to do (Phase 3 decision 2, hard line 3).
 * Kraken reports a key's permissions itself (`GetApiKeyInfo`), so unlike
 * Trading 212, Pip can refuse a key that could move money.
 */

/** Pip reads balances and the ledger — nothing else is needed. */
export const REQUIRED_PERMISSIONS = ["query-funds", "query-ledger"] as const;

/** Query-only extras that do no harm if ticked. Anything not listed is refused. */
const HARMLESS = new Set<string>([
  ...REQUIRED_PERMISSIONS,
  "query-open-trades",
  "query-closed-trades",
  "export-data",
]);

export interface PermissionCheck {
  ok: boolean;
  /** Required permissions the key lacks. */
  missing: string[];
  /** Permissions the key has that Pip refuses — trading, withdrawals, deposits, earn… */
  forbidden: string[];
}

export function checkKrakenPermissions(permissions: string[]): PermissionCheck {
  const missing = REQUIRED_PERMISSIONS.filter((p) => !permissions.includes(p));
  // Unknown names are refused too: a permission Kraken adds later is not assumed safe.
  const forbidden = permissions.filter((p) => !HARMLESS.has(p));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}
