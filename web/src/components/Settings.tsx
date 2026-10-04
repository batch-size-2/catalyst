import { useState } from "react";
import { ApiError, getSettings, getTiles, imageUrl, listBatches, setDefaultBaseline } from "../api";
import { batchColor, batchLabel, isUploadBatch, MIN_BASELINE_TILES, shortHash, useApi, utc } from "../lib";
import { href } from "../router";
import { BatchDot, IconCheck, IconWarn, Spinner } from "./bits";

/** Settings-Baseline: the default baseline, written to config/decision.yaml and locked once rules are frozen. */
export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [reload, setReload] = useState(0);
  const settings = useApi(getSettings, [reload]);
  const batches = useApi(listBatches);
  const tiles = useApi(getTiles);
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = settings.data?.baseline ?? null;
  const frozen = settings.data?.rules_frozen_commit ?? null;
  const tilesOf = (name: string) => (tiles.data ?? []).filter((t) => t.batch === name);
  const candidates = (batches.data ?? []).filter((b) => b.has_images && !isUploadBatch(b.name) && tilesOf(b.name).length >= MIN_BASELINE_TILES);
  const chosen = pending ?? current;

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      const { baseline } = await setDefaultBaseline(pending);
      setDone(baseline);
      setPending(null);
      setReload((n) => n + 1);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? `Locked: ${err.message}.` : String(err instanceof Error ? err.message : err));
    }
    setSaving(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-9 px-10 pt-10 pb-16">
      <section aria-labelledby="h-base" className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <h1 id="h-base" className="m-0 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">
            Default baseline
          </h1>
          <p className="m-0 max-w-[640px] text-[15px] leading-[1.55] text-cx-muted">
            Every new batch is compared against this one unless you pick another on Compare. Usually the material the
            supplier promised. Folders with fewer than {MIN_BASELINE_TILES} tiles can't define a baseline range.
          </p>
        </div>

        {frozen && (
          <div role="note" className="flex items-start gap-3 rounded-[14px] border border-cx-line bg-cx-surface px-4 py-3.5 text-[13px] leading-normal text-cx-muted">
            <LockIcon />
            <span>
              Rules are frozen (<span className="mono">rules-frozen · {shortHash(frozen, 7)}</span>
              {settings.data?.rules_frozen_date ? `, ${utc(settings.data.rules_frozen_date)}` : ""}), so the default
              is locked. Changing it means a new freeze, and the audit log shows both. For a one-off comparison, pick another
              baseline on <a href={href.compare()}>Compare</a>.
            </span>
          </div>
        )}

        <div role="radiogroup" aria-label="Default baseline" className="grid grid-cols-3 gap-3">
          {candidates.map((b) => {
            const sel = chosen === b.name;
            const thumbs = tilesOf(b.name).slice(0, 3);
            return (
              <button
                key={b.name}
                type="button"
                role="radio"
                aria-checked={sel}
                disabled={!!frozen}
                onClick={() => {
                  setDone(null);
                  setError(null);
                  setPending(b.name === current ? null : b.name);
                }}
                className={`flex flex-col gap-3 rounded-[18px] p-3.5 text-left text-cx-text ${frozen ? "cursor-not-allowed" : "cursor-pointer"} ${frozen && !sel ? "opacity-55" : ""}`}
                style={{
                  font: "inherit",
                  border: `1.5px solid ${sel ? batchColor(b.name) : "rgba(255,255,255,.1)"}`,
                  background: sel ? "rgba(255,255,255,.05)" : "var(--cx-surface)",
                  boxShadow: sel ? "0 0 0 4px rgba(255,255,255,.04)" : "none",
                }}
              >
                <div className="grid w-full grid-cols-3 gap-1">
                  {thumbs.map((t) => (
                    <img key={t.image_id} src={imageUrl(t.batch, t.image_id, "BSE")} alt="" loading="lazy" className="block aspect-square w-full rounded-lg object-cover" />
                  ))}
                </div>
                <div className="flex w-full items-center gap-2.5">
                  <span
                    className="box-border h-[18px] w-[18px] flex-none rounded-full"
                    style={sel ? { border: `5px solid ${batchColor(b.name)}`, background: "var(--cx-bg)" } : { border: "1.5px solid rgba(255,255,255,.3)" }}
                  />
                  <BatchDot name={b.name} size={10} />
                  <span className="text-base font-medium">{batchLabel(b.name)}</span>
                  {b.name === current && (
                    <span className="mono rounded-[5px] border border-cx-batch-3/45 px-1.5 py-0.5 text-[10px] text-[#5EEAD4]">CURRENT</span>
                  )}
                  <span className="ml-auto text-xs text-cx-faint">{tilesOf(b.name).length} tiles</span>
                </div>
              </button>
            );
          })}
        </div>

        {pending && current && (
          <div
            role="alertdialog"
            aria-label="Confirm baseline change"
            className="glass flex flex-wrap items-center gap-4 rounded-[18px] px-5 py-[18px]"
            style={{ background: "linear-gradient(180deg, rgba(255,122,47,.1), rgba(255,255,255,.02))" }}
          >
            <div className="flex flex-[1_1_380px] flex-col gap-1">
              <span className="text-[15px] font-medium">
                Change the default from {batchLabel(current)} to {batchLabel(pending)}?
              </span>
              <span className="text-[13px] leading-normal text-cx-text-2">
                New comparisons use {batchLabel(pending)}. Past decisions keep the baseline they used, and each entry in the
                audit log shows its own. The change is written to <span className="mono">config/decision.yaml</span>.
              </span>
            </div>
            <button className="btn" type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="btn pri" type="button" disabled={saving} onClick={() => void confirm()}>
              {saving && <Spinner size={14} color="var(--cx-on-orange)" />}
              Change default
            </button>
          </div>
        )}
        {done && (
          <div role="status" className="flex items-center gap-2.5 rounded-[14px] border border-cx-accept/30 bg-cx-accept/[0.08] px-4 py-3 text-sm text-cx-accept-text">
            <IconCheck size={16} />
            Default baseline is now {batchLabel(done)}.
            <a href={href.compare()} className="ml-auto">Compare a batch</a>
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2.5 rounded-[14px] border border-cx-investigate/40 bg-cx-investigate/10 px-4 py-3 text-sm text-cx-investigate-text">
            <IconWarn size={16} />
            {error}
          </div>
        )}

        {!frozen && (
          <div className="flex items-start gap-3 rounded-[14px] border border-cx-line bg-cx-surface px-4 py-3.5 text-[13px] leading-normal text-cx-muted">
            <LockIcon />
            <span>
              Once rules are frozen (<span className="mono">rules-frozen</span> tag), the default locks. Changing it after that
              means a new freeze, and the audit shows both.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 flex-none">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
