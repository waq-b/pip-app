import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Provider keys at rest (design rule 5).
 *
 * AES-256-GCM with `MASTER_KEY`, which lives in Render's environment — never
 * in Supabase, so the key and the ciphertext it opens sit with different
 * providers. Decryption happens here, in Fastify's memory, for the moment of a
 * provider call. Nothing in this module logs, and nothing it returns is meant
 * to leave the process.
 *
 * Stored form: `pip:<keyVersion>:<iv>:<tag>:<ciphertext>`, base64url parts.
 * The version names which master key sealed it, so a rotation can decrypt with
 * the previous key and re-seal with the new one (runbook: ARCHITECTURE.md).
 *
 * Every value is sealed with a **context** — e.g. `user:<id>|trading212|isa|key`
 * — bound in as GCM additional data. A ciphertext copied into another user's
 * row, or from the key column into the secret column, fails to open rather
 * than quietly decrypting as someone else's credential.
 */

const PREFIX = "pip";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface MasterKey {
  version: number;
  key: Buffer;
}

export interface SecretBox {
  seal(plaintext: string, context: string): string;
  open(sealed: string, context: string): string;
  /** True when a value was sealed with an older master key and should be re-sealed. */
  isStale(sealed: string): boolean;
}

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export function createSecretBox(current: MasterKey, previous?: MasterKey): SecretBox {
  assertKey(current);
  if (previous) {
    assertKey(previous);
    if (previous.version === current.version) {
      throw new SecretBoxError("The previous master key must have a different version");
    }
  }

  const keys = new Map([[current.version, current.key]]);
  if (previous) keys.set(previous.version, previous.key);

  return {
    seal(plaintext, context) {
      requireContext(context);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", current.key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [PREFIX, current.version, b64(iv), b64(tag), b64(ciphertext)].join(":");
    },

    open(sealed, context) {
      requireContext(context);
      const { version, iv, tag, ciphertext } = parse(sealed);
      const key = keys.get(version);
      if (!key) throw new SecretBoxError(`No master key for version ${version}`);
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        // Deliberately vague: wrong key, wrong context and tampering all look
        // the same from outside, and the reason isn't worth leaking.
        throw new SecretBoxError("Could not open sealed value");
      }
    },

    isStale(sealed) {
      return parse(sealed).version !== current.version;
    },
  };
}

/**
 * Reads `MASTER_KEY` (+ `MASTER_KEY_VERSION`, default 1) and, during a
 * rotation only, `MASTER_KEY_PREVIOUS` (+ `MASTER_KEY_PREVIOUS_VERSION`).
 * Returns undefined when no master key is configured; callers that need one
 * refuse to start (see `config.ts`).
 */
export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | undefined {
  if (!env.MASTER_KEY) return undefined;
  const current = masterKey(env.MASTER_KEY, env.MASTER_KEY_VERSION, "MASTER_KEY");
  const previous = env.MASTER_KEY_PREVIOUS
    ? masterKey(env.MASTER_KEY_PREVIOUS, env.MASTER_KEY_PREVIOUS_VERSION, "MASTER_KEY_PREVIOUS")
    : undefined;
  return createSecretBox(current, previous);
}

/** A new master key, base64, for `pnpm --filter api master-key`. */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

function masterKey(value: string, version: string | undefined, name: string): MasterKey {
  const key = Buffer.from(value.trim(), "base64");
  const parsedVersion = version === undefined ? 1 : Number(version);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    throw new SecretBoxError(`${name}_VERSION must be a positive whole number`);
  }
  // Never echo the value itself.
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`${name} must be ${KEY_BYTES} random bytes, base64-encoded`);
  }
  return { version: parsedVersion, key };
}

function assertKey({ version, key }: MasterKey) {
  if (!Number.isInteger(version) || version < 1) {
    throw new SecretBoxError("Master key version must be a positive whole number");
  }
  if (key.length !== KEY_BYTES) throw new SecretBoxError(`Master key must be ${KEY_BYTES} bytes`);
}

function requireContext(context: string) {
  if (!context) throw new SecretBoxError("A context is required to seal or open a value");
}

function parse(sealed: string) {
  const parts = sealed.split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX) throw new SecretBoxError("Not a sealed value");
  const version = Number(parts[1]);
  if (!Number.isInteger(version) || version < 1) throw new SecretBoxError("Not a sealed value");
  const [iv, tag, ciphertext] = parts.slice(2).map((part) => Buffer.from(part, "base64url")) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new SecretBoxError("Not a sealed value");
  return { version, iv, tag, ciphertext };
}

function b64(buffer: Buffer): string {
  return buffer.toString("base64url");
}
