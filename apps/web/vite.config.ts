import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const parsed = Number.parseInt(env.WORLD_SEED ?? "42", 10);
  const worldSeed = Number.isFinite(parsed) ? parsed : 42;

  return {
    plugins: [react()],
    define: {
      __AETHERLIFE_WORLD_SEED__: JSON.stringify(worldSeed),
    },
    optimizeDeps: {
      include: ["phaser"],
    },
    server: {
      port: Number(process.env.WEB_PORT) || 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:2567",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/v1": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
        "/matchmake": {
          target: "http://127.0.0.1:2567",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
