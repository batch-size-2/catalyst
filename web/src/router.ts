import { useEffect, useState } from "react";

/** Tiny hash router: "#/identify", "#/compare/<batch>[/<baseline>]", "#/library[/<batch>/<image_id>]",
 *  "#/audit", "#/settings". A baseline in the compare route is a one-off; without it, the default applies. */
export function useHashRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ["identify"];
}

export const href = {
  identify: () => "#/identify",
  compare: (batch?: string, baseline?: string | null) =>
    batch
      ? `#/compare/${encodeURIComponent(batch)}${baseline ? `/${encodeURIComponent(baseline)}` : ""}`
      : "#/compare",
  library: (batch?: string, imageId?: string) =>
    batch && imageId
      ? `#/library/${encodeURIComponent(batch)}/${encodeURIComponent(imageId)}`
      : "#/library",
  audit: () => "#/audit",
  settings: () => "#/settings",
};
