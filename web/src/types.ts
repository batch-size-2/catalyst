/** Mirror Pat's qc/attribute.py output (pat/ml-v3 @ 4557035); not part of qc/schema.py */

export type Verdict = "ACCEPT" | "INVESTIGATE" | "REJECT";
export type Status = "SIMILAR" | "DIFFERENT" | "UNCLEAR";
export type Unit = "image" | "strip";
export type Range = [number, number];

export interface Segment {
  batch: string;
  strip_id: string;
  image_ids: string[];
  area_um2: number | null;
  values: Record<string, number | null>;
}

export interface Difference {
  name: string;
  unit: string;
  key: boolean;
  used: boolean;
  note: string | null;
  reference: number | null;
  batch: number | null;
  difference: number | null;
  interval: Range | null;
  margin: number | null;
  p: number | null;
  status: Status;
  n_segments: [number, number];
}

export interface Power {
  n_segments: [number, number];
  n_arrangements: number;
  min_p: number;
  limited: boolean;
  extra_needed: number | null;
}

export interface UnitView {
  unit: Unit;
  power: Power;
  statuses: Record<string, Status>;
  contradictions: string[];
}

export interface Odd {
  strip_id: string;
  image_ids: string[];
  quantity: string;
  value: number;
  range: Range;
}

export interface ImagingCheck {
  changed: boolean;
  changed_metrics: string[];
  outliers_in_reference: string[];
  curtained_images: string[];
}

export interface ControlResult {
  name: string;
  kind: "negative" | "positive";
  expected_driver: string | null;
  statuses: Record<string, Status>;
  top_driver: string | null;
  passed: boolean;
}

export interface Controls {
  ran: boolean;
  passed: boolean | null;
  results: ControlResult[];
}

export interface Descriptor {
  name: string;
  unit: string;
  value: number | null;
  interval: Range | null;
  by_strip: Record<string, number | null>;
}

export interface Fingerprint {
  segments: Segment[];
  descriptors: Descriptor[];
  type_shares: Descriptor[];
}

/** qc/explain.py: fixed templates. Audience texts are lists of sentences. */
export interface Explanations {
  summary: string;        // the answer in one plain sentence
  rules: string[];        // the verdict rules that fired, in words
  next_steps: string[];
  ranked: string[];            // used key quantities not settled as similar, in driver order (the "Look here first" list)
  twin: string | null;         // a particle-type share that mirrors the other one, so it isn't shown
  within_tolerance: string[];  // settled as similar, minus paused ones and the twin
  operator: string[];
  engineer: string[];
  scientist: string[];
  manager: string[];
}

export interface InputFile {
  path: string;
  sha256: string;
}

export interface Provenance {
  inputs: InputFile[];
  git_commit: string | null;
  git_dirty: boolean | null;
  config_sha256: Record<string, string>;
  rules_frozen_commit: string | null;
  rules_frozen_date: string | null;
  created_at: string;
}

export interface Evidence {
  batch: string;
  baseline: string;
  verdict: Verdict;
  reasons: string[];
  next_action: string;
  unit: Unit;
  differences: Difference[];
  drivers: string[];
  power: Power;
  other_unit: UnitView;
  odd_images: Odd[];
  odd_strips: Odd[];
  new_type_share: number | null;
  imaging: ImagingCheck;
  controls: Controls;
  fingerprint: Fingerprint;
  n_images: Record<string, number>;
  explanations: Explanations;
  provenance: Provenance | null;
  config_version: string;
}

export interface ReasonClause {
  feature: string;
  label: string;
  baseline_z: number;
  direction: string;
  closest_batch: string | null;
  text: string;
  r?: number;
}

export interface AttributionReason {
  feature: string;
  z: number | null;             // against the training mean
  contribution: number | null;  // coefficient × z, toward the call of its stage
  stage?: "all" | "baseline" | "variation";
  label?: string;
  text?: string;                // plain-language sentence
  baseline_z?: number;          // named features only: SD against the baseline
  closest_batch?: string | null;
  related?: ReasonClause[];     // deep components only: the named features they move with
}

export interface Deviation {
  feature: string;
  label?: string;
  z: number | null;
  direction: string;
}

export type ConfidenceTier = "high" | "medium" | "low";

export interface TierRecord {
  right: number;
  n: number;
}

/** A stage's held-out record and whether it beats guessing (one-sided binomial p < 0.05). */
export interface StageRecord extends TierRecord {
  chance: number;
  p_value: number;
  established: boolean;
}

export interface StageCall {
  call: string;
  confidence: number;
  p_baseline?: number;
  interval?: [number, number];  // stage_baseline only: the range of `confidence` the held-out tiles allow (Venn–Abers)
  record?: StageRecord;         // this stage's held-out record; established = false means the call is a lean, not a finding
  note?: string;                // plain-language reason when the stage is not established
}

export interface AttributedImage {
  image_id: string;
  strip_id: string | null;
  predicted: string;
  confidence: number | null;
  confidence_raw?: number | null;
  confidence_tier?: ConfidenceTier;
  confidence_record?: TierRecord | null;  // held-out calls in this tier: right / n
  stage_baseline?: StageCall | null;      // "different from the baseline?"
  stage_variation?: StageCall | null;     // "in what way?", given it is not the baseline
  prediction_set?: string[];
  assigned?: string | null;
  reasons: AttributionReason[];
  baseline_distance: number | null;
  baseline_threshold: number | null;
  outside_baseline?: boolean | null;
  predicted_distance?: number | null;     // distance to the batch it was assigned to
  predicted_threshold?: number | null;
  unfamiliar: boolean | null;             // outside the range of the batch it was assigned to
  n_deviating?: number | null;
  deviations: Deviation[];
  [key: `p_${string}`]: number | null;
}

/** Held-out record of the calibrated calls (each strip calibrated with the other strips' tiles). */
export interface Calibration {
  method?: "venn_abers" | "none";
  temperature?: number;         // only in runs made before the Venn–Abers calibration
  n: number;
  accuracy?: number;
  balanced_accuracy?: number;
  log_loss?: number;
  raw_log_loss?: number;        // the same calls without calibration
  tiers: ({ tier: ConfidenceTier; min_confidence: number } & TierRecord)[];
  venn_abers?: { scores: number[]; labels: number[]; mean_width: number } | null;
  conformal: { alpha: number; qhat: number; n: number; coverage?: number; mean_size?: number } | null;
  stages: { baseline?: TierRecord; variation?: TierRecord };
}

export interface ImportantFeature {
  feature: string;
  label: string;
  share: number;                // of the stage's total |coefficient × z| over its training tiles
  higher_means: string;         // the call a higher value pulls towards
  related?: { feature: string; label: string; r: number }[];  // deep components: the named features they move with
  imaging?: { feature: string; label: string; r: number }[];  // deep components: the imaging descriptors they move with
}

/** What one stage of the model leans on overall (explain.importance in the model file). */
export interface StageImportance {
  n_features: number;
  families: Record<string, number>;
  features: ImportantFeature[];
}

export interface AttributionModelInfo {
  fitted_at: string;
  classes: string[];
  baseline: string;
  loso_balanced_accuracy: number | null;
  kind?: "flat" | "staged";
  families?: string[] | null;
  staged?: string[][] | null;
  calibration?: Calibration | null;
  importance?: Partial<Record<"all" | "baseline" | "variation", StageImportance>> | null;
}

/** GET /api/attribution-model: the model the next run will use. */
export interface ModelStatus extends AttributionModelInfo {
  n_trained_on: Record<string, number>;
  sha256: string;
  rules_frozen_commit: string | null;
  matches_frozen: boolean | null;  // the file is the one under the rules-frozen tag
}

export interface Attribution {
  run: string;
  model: AttributionModelInfo;
  images: AttributedImage[];
  summary: Record<string, number>;
}

export interface NullScores {
  n: number;
  mean: number | null;
  p95: number | null;
  max: number | null;
}

export interface SharedStripCheck {
  strip: string;
  batches: string[];
  n_images: number;
  accuracy: number;
  predicted: Record<string, string[]>;
}

export interface FamilyResult {
  families: string[];
  n_features: number;
  n_images: number;
  n_strips: number;
  balanced_accuracy: number | null;
  confusion: Record<string, Record<string, number>>;
  chosen_C: number[];
  null: NullScores | null;
  above_null: boolean;
  shared_strips: SharedStripCheck[];
  seconds: number | null;
}

export type RankedFeature = {
  feature: string;
  family: string;
  effect_size: number | null;
  loso_acc: number | null;
} & {
  [key: `mean_${string}`]: number | null;
};

export interface AttributionEvaluation {
  n_images: number;
  batches: string[];
  family_sets: Record<string, FamilyResult>;
  top_features: RankedFeature[];
}

export interface BatchSummary {
  name: string;
  has_images: boolean;
  verdict: Verdict | null;  // against the default baseline
}

/** GET /api/evidence: one comparison on disk, against any baseline. */
export interface Decision {
  batch: string;
  baseline: string;
  verdict: Verdict | null;
  created_at: string | null;
}

/** GET /api/settings */
export interface Settings {
  baseline: string;
  rules_frozen_commit: string | null;
  rules_frozen_date: string | null;
  rules_frozen_config: Record<string, { frozen: string | null; now: string | null }>;  // sha256 under the tag and now
  claude: { available: boolean; model: string; reason: string | null };
}

/** qc/guide.py: summary and walkthrough. Text holds {kind:key} slots that Catalyst filled from the evidence. */
export type GuideTarget = "verdict" | "moved" | "tiles" | "next";

export interface GuideSlot {
  text: string;
  source: string;
  label?: string;
  tile?: string;
  batch?: string;
  quantity?: string;
  tiles?: string[];
  status?: Status;
}

export interface GuideStep {
  target: GuideTarget;
  title: string;
  sentences: string[];
  source: string | null;
}

export interface Guide {
  source: "claude" | "template";
  model: string | null;
  fallback_reason: string | null;
  summary: string[];
  steps: GuideStep[];
  slots: Record<string, GuideSlot>;
  checks: { numbers: number; dropped: string[] };
}

/** One image in a data folder, joined with its out/kpis.csv row (GET /api/tiles). */
export interface Tile {
  batch: string;
  image_id: string;
  strip_id: string | null;
  detectors: string[];
  kpis: Record<string, number | null> | null;
  has_mask: boolean;
  has_layers: boolean;  // per-phase layers exist (GET /api/layers/{batch}/{image_id}/{silicon|pore|binder})
}

/** config/kpi_dictionary.yaml entry: friendly name, unit and causes per descriptor. */
export interface KpiEntry {
  name?: string;
  unit?: string;
  key?: boolean;
  meaning?: string;       // for particle types: the type's description from config/particle_types.json
  why_it_matters?: string;
  if_higher?: string;
  if_lower?: string;
  supplier_check?: string;
}

export type KpiDictionary = Record<string, KpiEntry | Record<string, KpiEntry>>;

/** POST /api/verify/{batch}: re-hashed provenance inputs and config files. */
export interface VerifyResult {
  ok: boolean;
  files: { path: string; ok: boolean }[];
  config_ok: boolean;
}

export interface Config {
  version: string;
  baseline: string;
  ci_level: number;
  alpha: number;
  unit: Unit;
  similar_margin: number;
  imaging_sensitive: string[];
  data_dir: string;
  [key: string]: unknown;
}

/** GET /api/particles/{batch}/{image_id}: tile size in full-res px and its largest Si particles. */
export interface TileParticles {
  width: number;
  height: number;
  px_um: number | null;
  particles: { x: number; y: number; d_um: number; type: string | null }[];
}

export type AttributionStage = "features" | "deep" | "predict";

export type RunEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; evidence: Evidence }
  | { type: "error"; message: string };

export type MeasureEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; measured: number }
  | { type: "error"; message: string };

export type AttributionEvent =
  | { type: "progress"; done: number; total: number; tile: string; stage?: AttributionStage }
  | { type: "done"; attribution: Attribution }
  | { type: "error"; message: string };
