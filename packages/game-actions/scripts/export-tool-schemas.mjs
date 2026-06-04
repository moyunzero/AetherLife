import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toOpenAIToolDefinitions } from "../dist/tools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "dist/tools.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(toOpenAIToolDefinitions(), null, 2)}\n`);
console.log(`Wrote ${outPath}`);
