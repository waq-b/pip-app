import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox, generateMasterKey, secretBoxFromEnv, SecretBoxError } from "./secrets.js";

const v1 = { version: 1, key: randomBytes(32) };
const v2 = { version: 2, key: randomBytes(32) };
const CONTEXT = "user:1|trading212|isa|key";

describe("sealing provider keys", () => {
  it("round-trips, and the sealed form never contains the plaintext", () => {
    const box = createSecretBox(v1);
    const sealed = box.seal("super-secret-api-key", CONTEXT);

    expect(sealed).toMatch(/^pip:1:/);
    expect(sealed).not.toContain("super-secret-api-key");
    expect(Buffer.from(sealed.split(":")[4]!, "base64url").toString()).not.toContain("secret");
    expect(box.open(sealed, CONTEXT)).toBe("super-secret-api-key");
  });

  it("seals the same value differently every time", () => {
    const box = createSecretBox(v1);
    expect(box.seal("same", CONTEXT)).not.toBe(box.seal("same", CONTEXT));
  });

  it("refuses to open with the wrong master key", () => {
    const sealed = createSecretBox(v1).seal("key", CONTEXT);
    const other = createSecretBox({ version: 1, key: randomBytes(32) });
    expect(() => other.open(sealed, CONTEXT)).toThrow(SecretBoxError);
  });

  it("refuses to open a value moved to another user's row or another column", () => {
    const box = createSecretBox(v1);
    const sealed = box.seal("key", CONTEXT);
    expect(() => box.open(sealed, "user:2|trading212|isa|key")).toThrow(SecretBoxError);
    expect(() => box.open(sealed, "user:1|trading212|isa|secret")).toThrow(SecretBoxError);
  });

  it("detects tampering", () => {
    const box = createSecretBox(v1);
    const parts = box.seal("key", CONTEXT).split(":");
    const body = Buffer.from(parts[4]!, "base64url");
    body[0] = body[0]! ^ 1;
    parts[4] = body.toString("base64url");
    expect(() => box.open(parts.join(":"), CONTEXT)).toThrow("Could not open sealed value");
  });

  it("requires a context, so nothing is ever sealed unbound", () => {
    const box = createSecretBox(v1);
    expect(() => box.seal("key", "")).toThrow(SecretBoxError);
  });

  it("rejects things that aren't sealed values", () => {
    const box = createSecretBox(v1);
    for (const bad of ["", "plain-key", "pip:1:a:b", "pip:x:a:b:c", "nope:1:a:b:c"]) {
      expect(() => box.open(bad, CONTEXT)).toThrow(SecretBoxError);
    }
  });
});

describe("rotating the master key", () => {
  it("opens old values with the previous key and flags them for re-sealing", () => {
    const sealedWithV1 = createSecretBox(v1).seal("key", CONTEXT);
    const rotating = createSecretBox(v2, v1);

    expect(rotating.isStale(sealedWithV1)).toBe(true);
    const resealed = rotating.seal(rotating.open(sealedWithV1, CONTEXT), CONTEXT);
    expect(resealed).toMatch(/^pip:2:/);
    expect(rotating.isStale(resealed)).toBe(false);

    // Once the previous key is gone, only re-sealed values still open.
    const after = createSecretBox(v2);
    expect(after.open(resealed, CONTEXT)).toBe("key");
    expect(() => after.open(sealedWithV1, CONTEXT)).toThrow("No master key for version 1");
  });

  it("won't accept two keys with the same version", () => {
    expect(() => createSecretBox(v1, { version: 1, key: randomBytes(32) })).toThrow(SecretBoxError);
  });
});

describe("master key from the environment", () => {
  it("is absent when MASTER_KEY isn't set", () => {
    expect(secretBoxFromEnv({})).toBeUndefined();
  });

  it("reads a generated key", () => {
    const box = secretBoxFromEnv({ MASTER_KEY: generateMasterKey() })!;
    expect(box.open(box.seal("key", CONTEXT), CONTEXT)).toBe("key");
  });

  it("rejects a key of the wrong length without echoing it", () => {
    const short = Buffer.from("not-32-bytes").toString("base64");
    let message = "";
    try {
      secretBoxFromEnv({ MASTER_KEY: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/must be 32 random bytes/);
    expect(message).not.toContain(short);
  });

  it("rejects a bad version", () => {
    expect(() =>
      secretBoxFromEnv({ MASTER_KEY: generateMasterKey(), MASTER_KEY_VERSION: "0" }),
    ).toThrow(/positive whole number/);
  });
});
