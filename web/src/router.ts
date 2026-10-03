import { useEffect, useState } from "react";

/** Tiny hash router: "#/identify", "#/compare/<batch>", "#/library[/<batch>/<image_id>]", "#/audit". */
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
  compare: (batch?: string) => (batch ? `#/compare/${encodeURIComponent(batch)}` : "#/compare"),
  library: (batch?: string, imageId?: string) =>
    batch && imageId
      ? `#/library/${encodeURIComponent(batch)}/${encodeURIComponent(imageId)}`
      : "#/library",
  audit: () => "#/audit",
};
