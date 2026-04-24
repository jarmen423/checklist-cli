/**
 * Runtime bindings supplied by Cloudflare Workers.
 *
 * `DB` is the D1 source of truth. `ASSETS` serves the built Vite UI. The
 * `ADMIN_TOKEN` secret gates both browser and CLI access to the checklist.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
}
