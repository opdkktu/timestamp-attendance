/**
 * KKAH HR Portal — single source of truth for version/about info.
 * Loaded by every page AND by sw.js (via importScripts), so keep this file
 * free of anything DOM-specific (no `document`/`window`) — it must run in
 * both a browser page and a service worker.
 *
 * BUMP APP_VERSION EVERY TIME YOU REDEPLOY. Two things key off it:
 *   1. sw.js builds its cache name from APP_VERSION, so a bump auto-deletes
 *      the old cached shell on the next visit — staff never get stuck on
 *      a stale cached copy.
 *   2. version-ui.js compares this file's live APP_VERSION (fetched fresh,
 *      bypassing cache) against what a visitor last saw, and shows a
 *      "new version available — tap to refresh" banner if they differ.
 */
const APP_VERSION = '1.0.0';
const APP_BUILD_DATE = '2026-10-07';          // update alongside APP_VERSION on each deploy

// --- About System tab ---
const SYSTEM_LAUNCH_DATE = 'PASTE_YOUR_SYSTEM_LAUNCH_DATE_HERE'; // e.g. '1 September 2026'
const APP_DEVELOPER = 'Nick — Klinik Kesihatan Ayer Hitam';
const COPYRIGHT_HOLDER = 'Klinik Kesihatan Ayer Hitam';
