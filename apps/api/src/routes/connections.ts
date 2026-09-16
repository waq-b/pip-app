import type { ConnectPermission, ConnectResult, ProviderId } from "@finance-app/shared";
import type { FastifyInstance } from "fastify";

const PROVIDERS: Record<ProviderId, string> = {
  trading212: "Trading 212",
  kraken: "Kraken",
};

/** Shortest key either provider issues; anything below this is a typo. */
const MINIMUM_KEY_LENGTH = 16;

/**
 * Connecting an account, Phase 1 shape: every screen and state is real, and
 * **nothing is stored**. Phase 2 swaps the body of these handlers for real
 * validation against the provider and encrypted per-user storage; the responses
 * the frontend sees do not change.
 *
 * A key that can trade or withdraw is refused outright rather than warned
 * about (CLAUDE.md s13). That is a hard requirement, not a preference, so it
 * lives here rather than in the UI.
 */
export function registerConnectionRoutes(app: FastifyInstance): void {
  app.post<{ Params: { provider: string }; Body?: { key?: string } }>(
    "/connections/:provider",
    async (request, reply) => {
      const provider = parseProvider(request.params.provider);
      if (!provider) return reply.status(404).send({ error: "unknown_provider" });

      const result = inspectKey(provider, request.body?.key ?? "");

      // 200 for every outcome: "that key can do too much" is a considered
      // answer about the key, not a malformed request.
      return reply.status(200).send(result);
    },
  );

  app.delete<{ Params: { provider: string } }>("/connections/:provider", async (request, reply) => {
    const provider = parseProvider(request.params.provider);
    if (!provider) return reply.status(404).send({ error: "unknown_provider" });

    // Nothing was ever stored, so there is nothing to remove. The route
    // exists so the frontend's Disconnect button has somewhere to go.
    return reply.status(200).send({ status: "disconnected", provider });
  });
}

/**
 * The stub's judgement, from the key's shape alone: too short to be real, or
 * carrying scopes Pip refuses, or acceptable.
 */
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
      permissions: permissionsFor(),
    };
  }

  return {
    outcome: "connected",
    provider,
    message: `Connected. Pip checked: this key cannot place orders.`,
  };
}

function permissionsFor(): ConnectPermission[] {
  return [
    { name: "Query funds", granted: true, required: true },
    { name: "Create & cancel orders", granted: true, required: false },
    { name: "Withdraw funds", granted: true, required: false },
  ];
}

function parseProvider(value: string): ProviderId | undefined {
  return (Object.keys(PROVIDERS) as ProviderId[]).find((provider) => provider === value);
}
