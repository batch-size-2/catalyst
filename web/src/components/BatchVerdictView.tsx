import { useEffect, useState } from "react";
import { getAttribution } from "../api";
import type { Evidence, ImageCall } from "../types";
import Differences from "./Differences";
import ExplanationTabs from "./ExplanationTabs";
import ProvenancePanel from "./ProvenancePanel";
import TileGallery from "./TileGallery";
import VerdictCard from "./VerdictCard";

export default function BatchVerdictView({ evidence, batches }: { evidence: Evidence; batches: string[] }) {
  const [calls, setCalls] = useState<ImageCall[]>([]);

  useEffect(() => {
    let current = true;
    setCalls([]);
    getAttribution(evidence.batch).then(
      (attribution) => {
        if (current) setCalls(attribution.calls);
      },
      () => getAttribution("known").then(
        (attribution) => {
          if (current) setCalls(attribution.calls.filter((call) => call.folder === evidence.batch));
        },
        () => {
          if (current) setCalls([]);
        },
      ),
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
