import { getModelStatus, getSettings, getTiles } from "./api";
import Audit from "./components/Audit";
import Compare from "./components/Compare";
import Identify from "./components/Identify";
import Impact from "./components/Impact";
import Library from "./components/Library";
import { PeekProvider } from "./components/Peek";
import Settings from "./components/Settings";
import Shell, { type Crumb, type ShellInfo } from "./components/Shell";
import { Cat, Spinner } from "./components/bits";
import { flagOn } from "./flags";
import { batchLabel, libraryTiles, useApi } from "./lib";
import { lazy, Suspense, useEffect, useState } from "react";
import { href, replaceRoute, useHashRoute } from "./router";

const AnodeLab = lazy(() => import("./slab/SlabLab"));  // three.js stays out of the main bundle

const PAGES: Record<string, { title: string; to: string; flag?: "impact" | "anode" }> = {
  identify: { title: "Identify tile", to: href.identify() },
  compare: { title: "Compare batch", to: href.compare() },
  library: { title: "Library", to: href.library() },
  audit: { title: "Audit log", to: href.audit() },
  settings: { title: "Settings", to: href.settings() },
  impact: { title: "Wear & impact", to: href.impact(), flag: "impact" },
  anode: { title: "Anode lab", to: href.anode(), flag: "anode" },
};

export default function App() {
  const route = useHashRoute();
  const page = PAGES[route[0]] ? route[0] : "identify";
  const [saved, setSaved] = useState(0);
  const settings = useApi(getSettings, [route.join("/"), saved], { keep: true });
  const tiles = useApi(getTiles, [route.join("/")], { keep: true });
  const baseline = settings.data?.baseline ?? null;
  const model = useApi(getModelStatus, [route.join("/")], { keep: true });

  useEffect(() => {
    if (!PAGES[route[0]]) replaceRoute(href.identify());  // an unknown page: Identify, with a URL that says so
  }, [route[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const info: ShellInfo = {
    baseline,
    baselineTiles: baseline ? (tiles.data?.filter((t) => t.batch === baseline).length ?? null) : null,
    totalTiles: tiles.data ? libraryTiles(tiles.data).length : null,
    frozen: settings.data?.rules_frozen_commit ?? null,
    modelChanged: model.data?.matches_frozen === false,
  };

  const { title, to, flag } = PAGES[page];
  const [, a, b] = page === route[0] ? route : [];
  const crumbs: Crumb[] = [{ label: title, href: to }];
  if (page === "library" && a) crumbs.push({ label: a === "uploads" ? "Uploads" : batchLabel(a), href: href.library(a) });
  if (page === "library" && a && b) crumbs.push({ label: <span className="mono">{b}</span> });
  if (page === "identify" && a) crumbs.push({ label: batchLabel(a) });

  useEffect(() => {
    document.title = `${title} · Catalyst`;
  }, [title]);

  const off = flag && !flagOn(flag);
  return (
    <PeekProvider>
    <Shell page={page} crumbs={crumbs} info={info} wide={page === "anode" && !off}>
      {off ? (
        <p className="mx-auto w-full max-w-[1180px] px-10 py-16 text-cx-muted">
          {title} is switched off. <a href={`/?flags=${to}`}>Switch it on</a>
        </p>
      ) : (
        <>
          {page === "identify" && <Identify routeDrop={a} routeImage={b} />}
          {page === "compare" && <Compare routeBatch={a} routeBaseline={b} />}
          {page === "library" && <Library routeBatch={a} routeImage={b} />}
          {page === "impact" && <Impact routeBatch={a} routeBaseline={b} />}
          {page === "audit" && <Audit />}
          {page === "settings" && <Settings onSaved={() => setSaved((n) => n + 1)} />}
          {page === "anode" && (
            <Suspense fallback={
              <div className="grid flex-1 place-items-center gap-3 py-24 text-sm text-cx-muted">
                <Cat mood="sniffing" size={48} />
                <Spinner />
              </div>
            }>
              <AnodeLab />
            </Suspense>
          )}
        </>
      )}
    </Shell>
    </PeekProvider>
  );
}
