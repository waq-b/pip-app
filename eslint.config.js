import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.vite/**", "**/dev-dist/**"],
  },
  {
    // The research wall (Phase 5, hard line 2): research/ is handed values and
    // hands back text. apps/api/src/research/wall.test.ts proves it; this
    // catches a crossing in the editor first.
    files: ["apps/api/src/research/**/*.ts"],
    ignores: ["apps/api/src/research/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(\\.\\.?/)+(app|server|config|logging|web|auth|crypto|db|dev|facts|fixtures|jobs|market|nudges|providers|read|routes|rules|sync|test-support|valuation)(\\.js)?(/|$)",
              message: "research/ can't import from the rest of the API (the research wall).",
            },
            {
              regex: "^(?!\\.|@finance-app/shared$)",
              message: "research/ can only import its own files and @finance-app/shared.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "research/ never makes requests." },
        { name: "process", message: "research/ never reads the environment." },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
