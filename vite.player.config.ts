import { defineConfig } from "vite";

// Builds the stand-alone player used inside exported interactive episodes.
export default defineConfig({
  publicDir: false,
  build: {
    target: "es2020",
    outDir: "public/player",
    emptyOutDir: true,
    lib: { entry: "src/player/main.ts", name: "BridgePlayer", formats: ["iife"], fileName: () => "player.js" },
    rollupOptions: { output: { assetFileNames: "player[extname]" } },
  },
});
