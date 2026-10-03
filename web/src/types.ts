/** Mirrors qc/schema.py (Evidence) and qc/api.py (BatchSummary, run events). Update together. */

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
