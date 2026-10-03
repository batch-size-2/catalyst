/**
 * Feature flags for Labs features. On when listed in VITE_FLAGS (build time, comma-separated)
 * or in localStorage "catalyst.flags". Visiting any page with ?flags=impact stores the list;
 * ?flags= clears it.
 */
const KEY = "catalyst.flags";
const list = (value: string | null | undefined) =>
  (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function stored(): string | null {
  try {
    const query = new URLSearchParams(window.location.search).get("flags");
    if (query !== null) window.localStorage.setItem(KEY, query);
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // storage disabled: only VITE_FLAGS counts
  }
}

const enabled = new Set([...list(import.meta.env.VITE_FLAGS), ...list(stored())]);

export const flagOn = (name: "impact") => enabled.has(name);
