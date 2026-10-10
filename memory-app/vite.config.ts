import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "../public", emptyOutDir: true },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  test: { include: ["src/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
