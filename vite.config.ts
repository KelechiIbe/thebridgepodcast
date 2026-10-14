import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
  worker: { format: "es" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as any);
