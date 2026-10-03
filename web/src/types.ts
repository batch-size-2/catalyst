/** Mirrors qc/schema.py (Evidence, Attribution) and qc/api.py (BatchSummary, run events). Update together. */

export type Verdict = "ACCEPT" | "INVESTIGATE" | "REJECT";
export type Status = "SIMILAR" | "DIFFERENT" | "UNCLEAR";
export type Unit = "image" | "strip";
export type AttributionScheme = "leave-one-strip-out" | "leave-one-image-out" | "held-out";
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

export interface FeatureProfile {
  name: string;
  unit: string;
  family: string | null;
  used: boolean;
  eta2: number | null;
  mean: Record<string, number | null>;
  sd: Record<string, number | null>;
}

export interface FeatureCall {
  name: string;
  value: number | null;
  z: Record<string, number | null>;
  contribution: number | null;
}

export interface ImageCall {
  image_id: string;
  folder: string;
  strip_id: string | null;
  predicted: string;
  probabilities: Record<string, number>;
  assigned: string | null;
  truth: string | null;
  features: FeatureCall[];
  nearest: string[];
  heatmap: string | null;
  outside_baseline: string[];
  unfamiliar: boolean;
  why: string[];
}

export interface Evaluation {
  scheme: AttributionScheme;
  n: number;
  accuracy: number;
  balanced_accuracy: number;
  null_95: number | null;
  confusion: Record<string, Record<string, number>>;
}

export interface Attribution {
  run: string;
  batches: string[];
  baseline: string;
  model: InputFile | null;
  features: FeatureProfile[];
  evaluations: Evaluation[];
  clustering_ari: number | null;
  calls: ImageCall[];
  provenance: Provenance | null;
}

export interface BatchSummary {
  name: string;
  has_images: boolean;
  verdict: Verdict | null;
}

export interface Config {
  version: string;
  baseline: string;
  ci_level: number;
  alpha: number;
  unit: Unit;
}

export type RunEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; evidence: Evidence }
  | { type: "error"; message: string };

export type AttributionEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; attribution: Attribution }
  | { type: "error"; message: string };
