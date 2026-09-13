// The studio is fully client-driven (localStorage project, IndexedDB audio
// cache, Web Audio playback). Server rendering would bake the demo project
// into the HTML and then clash with the persisted project during hydration
// (hydration_html_changed in {@html} blocks like the clip text line).
// Render client-only instead.
export const ssr = false;
