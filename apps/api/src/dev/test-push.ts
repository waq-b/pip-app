import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { createNotifier, type Notifier, type PushOutcome } from "../notify/notify.js";
import { stubEmailSender, webPushSender } from "../notify/senders.js";
import { dbNotificationStore } from "../notify/store.js";

/**
 * A test push to one person's devices, through Pip's real notifier — their
 * switches, the device list, delivery bookkeeping and 404/410 clean-up all
 * apply, exactly as for a real alert. Run by hand, from a laptop:
 *
 *   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… pnpm --filter api test-push [email]
 *
 * The keys come from the environment (the pair set in Render); they're never
 * printed. Sends nothing that can act on money: a title, a line and "/".
 */

export const TEST_MESSAGE = {
  title: "Test from Pip",
  body: "If you can read this, pushes reach this device.",
  url: "/",
};

export function vapidFrom(env: NodeJS.ProcessEnv) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (the pair in Render) first");
  }
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT ?? "https://pip.example.com" };
}

export async function sendTestPush(
  notifier: Notifier,
  userId: string,
  now = new Date(),
): Promise<PushOutcome> {
  return notifier.push(
    // A fresh key each time, so a second test isn't "already sent".
    { userId, kind: "digest", dedupeKey: `test:${now.toISOString()}`, message: TEST_MESSAGE },
    now,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.argv[2] ?? "test@example.com";
  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`${email} isn't on the allowlist`);
  const notifier = createNotifier({
    store: dbNotificationStore(db),
    push: webPushSender(vapidFrom(process.env)),
    email: stubEmailSender(),
    onError: (error) => console.error("push failed:", (error as Error).message),
  });
  console.log(await sendTestPush(notifier, user.id));
  process.exit(0);
}
