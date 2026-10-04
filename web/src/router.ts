import { useEffect, useState } from "react";

/** Tiny hash router: "#/identify[/<drop>[/<image_id>]]", "#/compare/<batch>[/<baseline>]",
 *  "#/library[/<batch>[/<image_id>]]", "#/audit", "#/settings", "#/impact/...", "#/anode" (experimental).
 *  A baseline in the compare route is a one-off; without it, the default applies. */
export function useHashRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length) parts[0] = parts[0].toLowerCase();
  return parts.length ? parts : ["identify"];
}

const path = (...parts: (string | null | undefined)[]) => {
  const given = parts.slice(1);
  const upTo = given.findIndex((p) => !p);
  return `#/${[parts[0], ...(upTo < 0 ? given : given.slice(0, upTo))].map((p) => encodeURIComponent(p!)).join("/")}`;
};

export const href = {
  identify: (drop?: string | null, imageId?: string | null) => path("identify", drop, imageId),
  compare: (batch?: string | null, baseline?: string | null) => path("compare", batch, baseline),
  library: (batch?: string | null, imageId?: string | null) => path("library", batch, imageId),
  impact: (batch?: string | null, baseline?: string | null) => path("impact", batch, baseline),
  audit: () => "#/audit",
  settings: () => "#/settings",
  anode: () => "#/anode",
};

/** Change the route without a new history entry (prev/next in a viewer, correcting a bad link). */
export const replaceRoute = (to: string) => window.location.replace(to);
