import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { buildApp } from "./app.js";
import { dbAllowlistStore } from "./auth/allowlist.js";
import { authConfigFromEnv, useSecureCookiesFromEnv } from "./auth/config.js";
import { dbSessionStore } from "./auth/session.js";
import { getDb } from "./db/client.js";
import { accounts, sessions, users, verificationTokens } from "./db/schema.js";

const adapter = DrizzleAdapter(getDb(), {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

const app = buildApp({
  authConfig: authConfigFromEnv(dbAllowlistStore, adapter),
  sessionStore: dbSessionStore,
  useSecureCookies: useSecureCookiesFromEnv(),
});
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`api listening on :${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
