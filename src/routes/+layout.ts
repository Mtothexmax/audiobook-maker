// The studio is fully client-driven (localStorage project, IndexedDB audio
// cache, Web Audio playback). Server rendering would bake the demo project
// into the HTML and then clash with the persisted project during hydration
// (hydration_html_changed in {@html} blocks like the clip text line), so the
// page renders client-only. `prerender` keeps the static GitHub Pages export
// working (it emits an app shell that boots in the browser).
// NOTE: export.ps1 backs this file up and restores it — keep both flags.
export const ssr = false;
export const prerender = true;


