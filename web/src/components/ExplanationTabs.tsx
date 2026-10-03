import { useState } from "react";
import type { Explanations } from "../types";

const tabs = [
  ["operator", "Operator"],
  ["engineer", "Engineer"],
  ["scientist", "Scientist"],
  ["manager", "Manager"],
] as const;

type Audience = (typeof tabs)[number][0];

export default function ExplanationTabs({ explanations }: { explanations: Explanations }) {
  const [active, setActive] = useState<Audience>("operator");
  const available = tabs.filter(([key]) => explanations[key]);
  if (!available.length) return null;
  const shown = available.find(([key]) => key === active) ?? available[0];

  return (
    <section className="animate-rise rounded-2xl border border-white/5 bg-slate-900/60 p-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Explanation audience">
        {tabs.map(([key, title]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={shown[0] === key}
            className={`rounded-full px-3 py-1.5 text-sm ${
              shown[0] === key ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
            onClick={() => setActive(key)}
          >
            {title}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300" role="tabpanel">{explanations[shown[0]]}</p>
    </section>
  );
}
