import type { Evidence, Guide, GuideSlot } from "../types";

/** The Compare page, top to bottom. `pageBlocks` only looks at what the API already returned. */
export type BlockId = "verdict" | "moved" | "tiles" | "next" | "folded";

export function hasOddTiles(evidence: Evidence): boolean {
  const odds = evidence.unit === "image" ? evidence.odd_images : evidence.odd_strips;
  return odds.length > 0;
}

/** The template says the odd tiles carry the shift when its summary does. No statistics here. */
export function oddTilesCarryTheShift(guide: Guide | null): boolean {
  return !!guide?.summary.some((s) => s.includes("shift comes from") && /\{whatif:[^{}\s]+\}/.test(s));
}

/** Which blocks show, and in what order. */
export function pageBlocks(evidence: Evidence, guide: Guide | null): BlockId[] {
  const tiles = hasOddTiles(evidence);
  const first = oddTilesCarryTheShift(guide);
  const blocks: BlockId[] = ["verdict"];
  if (tiles && first) blocks.push("tiles");
  blocks.push("moved");
  if (tiles && !first) blocks.push("tiles");
  if (evidence.explanations.next_steps.length > 0) blocks.push("next");
  blocks.push("folded");
  return blocks;
}

/** The what-if the template summary actually quotes. */
export function summaryWhatIf(guide: Guide | null): { key: string; slot: GuideSlot } | null {
  if (!guide) return null;
  for (const sentence of guide.summary) {
    const id = sentence.match(/\{whatif:([^{}\s]+)\}/)?.[1];
    const slot = id ? guide.slots[`whatif:${id}`] : undefined;
    if (id && slot) return { key: `whatif:${id}`, slot };
  }
  return null;
}

/** The first ranked property that has a what-if slot. */
export function rankedWhatIf(evidence: Evidence, guide: Guide | null): { key: string; slot: GuideSlot } | null {
  if (!guide) return null;
  const slots = Object.entries(guide.slots).filter(([key]) => key.startsWith("whatif:"));
  for (const quantity of evidence.explanations.ranked) {
    const hit = slots.find(([, slot]) => slot.quantity === quantity);
    if (hit) return { key: hit[0], slot: hit[1] };
  }
  return null;
}
