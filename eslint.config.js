import js from "@eslint/js";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"] },
  js.configs.recommended,
  {
    files: ["scripts/lib/**/*.mjs", "scripts/agent-verify.mjs"],
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
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
