import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm build` emits compiled output to dist/, which vitest's default
    // include would otherwise collect — running every suite twice, the second
    // time against whatever was last compiled.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
