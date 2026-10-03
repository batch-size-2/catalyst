import { useEffect, useState } from "react";
import { getAttribution } from "../api";
import type { AttributedImage, Evidence } from "../types";
import Differences from "./Differences";
import ExplanationTabs from "./ExplanationTabs";
import ProvenancePanel from "./ProvenancePanel";
import TileGallery from "./TileGallery";
import VerdictCard from "./VerdictCard";

export default function BatchVerdictView({ evidence, batches }: { evidence: Evidence; batches: string[] }) {
  const [calls, setCalls] = useState<AttributedImage[]>([]);

  useEffect(() => {
    let current = true;
    setCalls([]);
    getAttribution(evidence.batch).then(
      (attribution) => {
        if (current) setCalls(attribution.images);
      },
      () => {
        if (current) setCalls([]);
      },
    );
    return () => {
      current = false;
    };
  }, [evidence]);

  return (
    <div key={evidence.batch} className="space-y-6">
      <VerdictCard evidence={evidence} />
      <ExplanationTabs explanations={evidence.explanations} />
      <Differences evidence={evidence} />
      <TileGallery evidence={evidence} calls={calls} batches={batches} />
      <ProvenancePanel evidence={evidence} />
    </div>
  );
}
