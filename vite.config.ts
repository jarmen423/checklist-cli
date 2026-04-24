import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite builds the human-facing checklist UI into `dist/client`.
 *
 * Wrangler serves that directory through the Worker asset binding, while the
 * Worker itself owns the authenticated API routes under `/api/*`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
