import js from "@eslint/js";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"] },
  js.configs.recommended,
  {
    files: [
      "scripts/lib/**/*.mjs",
      "scripts/agent-verify.mjs",
      "scripts/gsd-review-providers.mjs",
      "scripts/assert-refusal-markers-parity.mjs",
      "scripts/playtest-speak-sla.mjs",
      "scripts/benchmark-speak-browser.mjs",
      "scripts/verify-phase21.mjs",
      "scripts/uat-phase21-playwright.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        document: "readonly",
        window: "readonly",
        performance: "readonly",
        localStorage: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
