import { dbResealStore, resealStaleCredentials } from "./reseal.js";
import { secretBoxFromEnv } from "./secrets.js";

// Runbook step 3: `pnpm --filter api reseal-keys`, with MASTER_KEY (new) and
// MASTER_KEY_PREVIOUS (old) both set. Prints counts, never keys.
const box = secretBoxFromEnv();
if (!box) throw new Error("MASTER_KEY is not set");
const version = Number(process.env.MASTER_KEY_VERSION ?? 1);
const result = await resealStaleCredentials(box, version, await dbResealStore());
console.log(`Re-sealed ${result.resealed} credential(s); ${result.failed} could not be opened.`);
process.exit(result.failed > 0 ? 1 : 0);
