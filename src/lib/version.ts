// Single source of truth for the app version: package.json, injected at build
// time via vite's `define` (see vite.config.ts). The build also emits a
// /version.json carrying the same value, which the "Check for updates" control
// fetches to learn the latest deployed version without a full reload.
export const APP_VERSION: string = __APP_VERSION__
