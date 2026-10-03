import { getConfig, getModelStatus, getTiles } from "./api";
import Audit from "./components/Audit";
import Compare from "./components/Compare";
import Identify from "./components/Identify";
import Impact from "./components/Impact";
import Library from "./components/Library";
import Shell, { type ShellInfo } from "./components/Shell";
import { flagOn } from "./flags";
import { batchLabel, isUploadBatch, useApi } from "./lib";
import { useHashRoute } from "./router";

export default function App() {
  const route = useHashRoute();
  const page = route[0];
  const config = useApi(getConfig);
  const tiles = useApi(getTiles, [route.join("/")]);
  const baseline = config.data?.baseline ?? null;
  const model = useApi(getModelStatus, [route.join("/")]);

  const info: ShellInfo = {
    baseline,
    baselineTiles: baseline ? (tiles.data?.filter((t) => t.batch === baseline).length ?? null) : null,
    totalTiles: tiles.data?.filter((t) => !isUploadBatch(t.batch)).length ?? null,
    frozen: model.data?.matches_frozen ? model.data.rules_frozen_commit : null,
    modelChanged: model.data?.matches_frozen === false,
  };

  const crumbs: Record<string, React.ReactNode[]> = {
    identify: ["Analyse", "Identify tile"],
    compare: ["Analyse", "Compare batch"],
    library:
      route[1] && route[2]
        ? ["Library", batchLabel(route[1]), <span key="id" className="mono">{route[2]}</span>]
        : ["Library"],
    impact: ["Labs", "Wear & impact"],
    audit: ["Trust", "Audit log"],
  };

  return (
    <Shell page={page} crumbs={crumbs[page] ?? ["Catalyst"]} info={info}>
      {page === "identify" && <Identify />}
      {page === "compare" && <Compare routeBatch={route[1]} />}
      {page === "library" && <Library routeBatch={route[1]} routeImage={route[2]} />}
      {page === "impact" &&
        (flagOn("impact") ? (
          <Impact routeBatch={route[1]} routeBaseline={route[2]} />
        ) : (
          <p className="mx-auto max-w-[640px] px-10 py-16 text-cx-muted">
            Wear &amp; impact is a Labs feature. Open <code className="mono">/?flags=impact</code> to switch it on.
          </p>
        ))}
      {page === "audit" && <Audit />}
    </Shell>
  );
}
