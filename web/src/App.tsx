import { getModelStatus, getSettings, getTiles } from "./api";
import Audit from "./components/Audit";
import Compare from "./components/Compare";
import Identify from "./components/Identify";
import Library from "./components/Library";
import { PeekProvider } from "./components/Peek";
import Settings from "./components/Settings";
import Shell, { type ShellInfo } from "./components/Shell";
import { batchLabel, libraryTiles, useApi } from "./lib";
import { useState } from "react";
import { useHashRoute } from "./router";

export default function App() {
  const route = useHashRoute();
  const page = route[0];
  const [saved, setSaved] = useState(0);
  const settings = useApi(getSettings, [route.join("/"), saved], { keep: true });
  const tiles = useApi(getTiles, [route.join("/")], { keep: true });
  const baseline = settings.data?.baseline ?? null;
  const model = useApi(getModelStatus, [route.join("/")], { keep: true });

  const info: ShellInfo = {
    baseline,
    baselineTiles: baseline ? (tiles.data?.filter((t) => t.batch === baseline).length ?? null) : null,
    totalTiles: tiles.data ? libraryTiles(tiles.data).length : null,
    frozen: settings.data?.rules_frozen_commit ?? null,
    modelChanged: model.data?.matches_frozen === false,
  };

  const crumbs: Record<string, React.ReactNode[]> = {
    identify: ["Analyse", "Identify tile"],
    compare: ["Analyse", "Compare batch"],
    library:
      route[1] && route[2]
        ? ["Library", batchLabel(route[1]), <span key="id" className="mono">{route[2]}</span>]
        : ["Library"],
    audit: ["Trust", "Audit log"],
    settings: ["Settings", "Baseline"],
  };

  return (
    <PeekProvider>
    <Shell page={page} crumbs={crumbs[page] ?? ["Catalyst"]} info={info}>
      {page === "identify" && <Identify />}
      {page === "compare" && <Compare routeBatch={route[1]} routeBaseline={route[2]} />}
      {page === "library" && <Library routeBatch={route[1]} routeImage={route[2]} />}
      {page === "audit" && <Audit />}
      {page === "settings" && <Settings onSaved={() => setSaved((n) => n + 1)} />}
    </Shell>
    </PeekProvider>
  );
}
