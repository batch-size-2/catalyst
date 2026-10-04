/**
 * Experimental features. On by default (listed in DEFAULT_ON) and shown in the sidebar as EXPERIMENTAL.
 * VITE_FLAGS (build time, comma-separated) or localStorage "catalyst.flags" add a feature with its name and
 * remove one with "-name". Visiting any page with ?flags=-impact stores the list; ?flags= clears it.
 */
type Flag = "impact";
const KEY = "catalyst.flags";
const DEFAULT_ON: Flag[] = ["impact"];
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

const enabled = new Set<string>(DEFAULT_ON);
for (const entry of [...list(import.meta.env.VITE_FLAGS), ...list(stored())])
  if (entry.startsWith("-")) enabled.delete(entry.slice(1));
  else enabled.add(entry);

export const flagOn = (name: Flag) => enabled.has(name);
