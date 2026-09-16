import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialContext, resealStaleCredentials, type SealedCredential } from "./reseal.js";
import { createSecretBox } from "./secrets.js";

const v1 = { version: 1, key: randomBytes(32) };
const v2 = { version: 2, key: randomBytes(32) };

function memoryStore(rows: SealedCredential[]) {
  return {
    rows,
    async stale(version: number) {
      return rows.filter((row) => row.keyVersion !== version);
    },
    async replace(id: string, sealedKey: string, sealedSecret: string, keyVersion: number) {
      Object.assign(
        rows.find((row) => row.id === id)!,
        { sealedKey, sealedSecret, keyVersion },
      );
    },
  };
}

function sealedWith(
  box: ReturnType<typeof createSecretBox>,
  version: number,
  id: string,
  userId: string,
) {
  const base = { id, userId, provider: "trading212", accountKind: "isa" };
  return {
    ...base,
    sealedKey: box.seal(`key-${id}`, credentialContext(base, "key")),
    sealedSecret: box.seal(`secret-${id}`, credentialContext(base, "secret")),
    keyVersion: version,
  };
}

describe("re-sealing after a master key rotation", () => {
  it("moves every old credential to the new key, leaving values unchanged", async () => {
    const old = createSecretBox(v1);
    const rotating = createSecretBox(v2, v1);
    const store = memoryStore([sealedWith(old, 1, "a", "u1"), sealedWith(rotating, 2, "b", "u2")]);

    expect(await resealStaleCredentials(rotating, 2, store)).toEqual({ resealed: 1, failed: 0 });

    const after = createSecretBox(v2);
    for (const row of store.rows) {
      expect(row.keyVersion).toBe(2);
      expect(after.open(row.sealedKey, credentialContext(row, "key"))).toBe(`key-${row.id}`);
      expect(after.open(row.sealedSecret, credentialContext(row, "secret"))).toBe(
        `secret-${row.id}`,
      );
    }
    expect(await resealStaleCredentials(rotating, 2, store)).toEqual({ resealed: 0, failed: 0 });
  });

  it("counts a row it can't open and carries on", async () => {
    const stranger = createSecretBox({ version: 1, key: randomBytes(32) });
    const old = createSecretBox(v1);
    const store = memoryStore([
      sealedWith(stranger, 1, "bad", "u1"),
      sealedWith(old, 1, "good", "u2"),
    ]);

    expect(await resealStaleCredentials(createSecretBox(v2, v1), 2, store)).toEqual({
      resealed: 1,
      failed: 1,
    });
    expect(store.rows.find((row) => row.id === "bad")!.keyVersion).toBe(1);
  });
});
