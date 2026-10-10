import { defineConfig } from "vite";
export default defineConfig({
  ssr: { noExternal: true },
  build: { ssr: "src/cloud-server.ts", outDir: "../functions/cloud", emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "[[path]].js" } } },
});
