import { generateMasterKey } from "./secrets.js";

// Prints a fresh MASTER_KEY. Put it straight into the host's environment
// (Render) — never into git, chat or a shared file. See the rotation runbook in
// docs/ARCHITECTURE.md.
console.log(generateMasterKey());
