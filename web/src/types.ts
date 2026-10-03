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

export interface Explanations {
  operator: string;
  engineer: string;
  scientist: string;
  manager: string;
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

export interface StageCall {
  call: string;
  confidence: number;
  p_baseline?: number;
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

export interface Calibration {
  temperature: number;
  n: number;
  accuracy?: number;
  tiers: ({ tier: ConfidenceTier; min_confidence: number } & TierRecord)[];
  conformal: { alpha: number; qhat: number; n: number } | null;
  stages: { baseline?: TierRecord; variation?: TierRecord };
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
  verdict: Verdict | null;
}

/** One image in a data folder, joined with its out/kpis.csv row (GET /api/tiles). */
export interface Tile {
  batch: string;
  image_id: string;
  strip_id: string | null;
  detectors: string[];
  kpis: Record<string, number | null> | null;
  has_mask: boolean;
}

/** config/kpi_dictionary.yaml entry: friendly name, unit and causes per descriptor. */
export interface KpiEntry {
  name?: string;
  unit?: string;
  key?: boolean;
  meaning?: string;
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

export type RunEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; evidence: Evidence }
  | { type: "error"; message: string };

export type AttributionEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; attribution: Attribution }
  | { type: "error"; message: string };
