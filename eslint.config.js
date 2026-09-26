import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".netlify", "supabase/.temp", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Kept as an error on purpose: this is the rule that catches a server
      // function or helper that was written and imported but never wired to
      // the UI. Three dead handlers shipped while it was off (an agenda
      // delete, a family-event delete and a local-date helper), each one a
      // feature that looked done in the code and did nothing in the browser.
      // `_`-prefixed names stay exempt for deliberately unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Vendored shadcn/ui components. Upstream deliberately ships the cva
    // variant functions and context hooks from the same file as the
    // component (buttonVariants, toggleVariants, useFormField, useSidebar,
    // navigationMenuTriggerStyle), and sibling components import them from
    // there. Splitting them would fork these files from upstream and make
    // every future `shadcn add` conflict, so the fast-refresh rule is scoped
    // off here rather than in our own components.
    files: ["src/components/ui/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
);
