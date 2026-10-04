import assert from "node:assert/strict";
import { test } from "node:test";
import { pageBlocks } from "./src/compare/pageBlocks.ts";
import type { Evidence, Guide } from "./src/types.ts";

/** The four real comparisons, reduced to the fields pageBlocks reads. */
function evidence(odd: number, next: string[]): Evidence {
  return {
    unit: "image",
    odd_images: Array.from({ length: odd }, (_, i) => ({ image_ids: [`tile${i}`] })),
    odd_strips: [],
    explanations: { next_steps: next, ranked: [] },
  } as unknown as Evidence;
}

function guide(summary: string[]): Guide {
  return { summary } as Guide;
}

const CARRY = "Most of the silicon-to-graphite ratio shift comes from {tile:4ih2ggld.si_graphite_ratio} and {tile:5n1q8atc.si_graphite_ratio}; without them Batch 1 averages {whatif:1}.";
const NEXT = ["Check the microscope settings."];

test("Batch 1 vs Batch 3: two odd tiles carry the shift, so tiles come before what moved", () => {
  assert.deepEqual(pageBlocks(evidence(2, NEXT), guide([CARRY])), [
    "verdict", "tiles", "moved", "next", "folded",
  ]);
});

test("Batch 1 vs Batch 2: three odd tiles, and the what-if still says they carry the shift", () => {
  assert.deepEqual(pageBlocks(evidence(3, NEXT), guide([CARRY])), [
    "verdict", "tiles", "moved", "next", "folded",
  ]);
});

test("Batch 2 vs Batch 3: nothing odd, so no tiles block", () => {
  assert.deepEqual(
    pageBlocks(evidence(0, NEXT), guide(["Every key property that could be checked sits within the tolerance of the baseline."])),
    ["verdict", "moved", "next", "folded"],
  );
});

test("Batch 3 vs Batch 3: no odd tiles and only a controls next step, same block order", () => {
  assert.deepEqual(
    pageBlocks(evidence(0, ["Run the known-answer controls, then re-run."]), guide(["Every key property sits within the tolerance of the baseline."])),
    ["verdict", "moved", "next", "folded"],
  );
});

test("odd tiles stay under what moved when the what-if does not say they carry the shift", () => {
  assert.deepEqual(
    pageBlocks(evidence(2, NEXT), guide(["{tile:a.q} and {tile:b.q} sit outside the baseline range; without them Batch 1 still averages {whatif:1}."])),
    ["verdict", "moved", "tiles", "next", "folded"],
  );
});
