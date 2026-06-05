import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
});
