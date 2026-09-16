import type {
  AccountKind,
  Connection,
  ConnectRequest,
  ConnectResult,
  ProviderId,
} from "@finance-app/shared";
import type { FastifyInstance } from "fastify";
import type { AllowedUser } from "../auth/allowlist.js";
import type { VerifiedUser } from "../auth/jwt.js";
import { connectionsAt } from "../fixtures/portfolio.js";

/**
 * Connecting an account. The routes only parse and hand over; what connecting
 * means depends on the mode — stub mode inspects the key's shape and stores
 * nothing (Phase 1), Trading 212 mode validates against the provider and seals
 * the key (`sync/connections.ts`). Keys arrive in the body and never leave it:
 * Fastify doesn't log bodies, the logger redacts key-shaped fields, and no
 * response ever echoes one.
 */

export interface ConnectionUser {
  /** Allowlist row id. */
  userId: string;
  /** Verified Supabase id, for reading as the user (RLS). */
  authUserId: string;
}

export interface ConnectionService {
  list(user: ConnectionUser): Promise<Connection[]>;
  connect(
    user: ConnectionUser,
    provider: ProviderId,
    request: ConnectRequest,
  ): Promise<ConnectResult>;
  disconnect(user: ConnectionUser, provider: ProviderId, accountKind?: AccountKind): Promise<void>;
}

const PROVIDERS: Record<ProviderId, string> = { trading212: "Trading 212", kraken: "Kraken" };
const ACCOUNT_KINDS: AccountKind[] = ["isa", "invest"];

export function registerConnectionRoutes(
  app: FastifyInstance,
  options: { service: ConnectionService },
): void {
  const userOf = (request: {
    authUser?: VerifiedUser;
    allowedUser?: AllowedUser;
  }): ConnectionUser => ({
    userId: request.allowedUser!.id,
    authUserId: request.authUser!.authUserId,
  });

  app.get("/connections", async (request) => options.service.list(userOf(request)));

  app.post<{ Params: { provider: string }; Body?: Partial<ConnectRequest> }>(
    "/connections/:provider",
    async (request, reply) => {
      const provider = parseProvider(request.params.provider);
      if (!provider) return reply.status(404).send({ error: "unknown_provider" });

      const body = request.body ?? {};
      const accountKind = parseAccountKind(body.accountKind);
      if (provider === "trading212" && !accountKind) {
        return reply.status(400).send({ error: "account_kind_required" });
      }
      const result = await options.service.connect(userOf(request), provider, {
        accountKind,
        key: typeof body.key === "string" ? body.key.trim() : "",
        secret: typeof body.secret === "string" ? body.secret.trim() : undefined,
      });
      // 200 for every outcome: "that key can do too much" is an answer about the key.
      return reply.status(200).send(result);
    },
  );

  app.delete<{ Params: { provider: string }; Querystring: { accountKind?: string } }>(
    "/connections/:provider",
    async (request, reply) => {
      const provider = parseProvider(request.params.provider);
      if (!provider) return reply.status(404).send({ error: "unknown_provider" });
      const accountKind = parseAccountKind(request.query.accountKind);
      if (provider === "trading212" && !accountKind) {
        return reply.status(400).send({ error: "account_kind_required" });
      }
      await options.service.disconnect(userOf(request), provider, accountKind);
      return reply.status(200).send({ status: "disconnected", provider, accountKind });
    },
  );
}

/** Phase 1 behaviour, kept for stub mode: judge the key's shape, store nothing. */
export const stubConnectionService: ConnectionService = {
  async list() {
    return connectionsAt(new Date());
  },
  async connect(_user, provider, request) {
    return { ...inspectKey(provider, request.key), accountKind: request.accountKind };
  },
  async disconnect() {
    // Nothing was ever stored.
  },
};

/** Shortest key either provider issues; anything below this is a typo. */
const MINIMUM_KEY_LENGTH = 16;

export function inspectKey(provider: ProviderId, rawKey: string): ConnectResult {
  const name = PROVIDERS[provider];
  const key = rawKey.trim();

  if (key.length < MINIMUM_KEY_LENGTH) {
    return {
      outcome: "invalid_key",
      provider,
      message: `${name} doesn't recognise that key. Usually a stray space at one end, or the key was deleted at ${name}'s side. Nothing is connected, and nothing was changed.`,
    };
  }

  if (/trade|withdraw/i.test(key)) {
    return {
      outcome: "too_much_access",
      provider,
      message: `That key can do too much. It can trade and withdraw. Pip only ever accepts keys that can look, so it won't store this one.`,
      permissions: [
        { name: "Query funds", granted: true, required: true },
        { name: "Create & cancel orders", granted: true, required: false },
        { name: "Withdraw funds", granted: true, required: false },
      ],
    };
  }

  return {
    outcome: "connected",
    provider,
    message: `Connected. Pip checked: this key cannot place orders.`,
  };
}

function parseProvider(value: string): ProviderId | undefined {
  return (Object.keys(PROVIDERS) as ProviderId[]).find((provider) => provider === value);
}

function parseAccountKind(value: unknown): AccountKind | undefined {
  return ACCOUNT_KINDS.find((kind) => kind === value);
}
