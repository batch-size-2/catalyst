import type { ReactNode } from "react";
import { flagOn } from "../flags";
import { href } from "../router";
import { BatchDot, CAT } from "./bits";
import { batchLabel, shortHash } from "../lib";

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const ICONS = {
  identify: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="4" width="7" height="16" rx="1.5" />
      <rect x="14" y="4" width="7" height="16" rx="1.5" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  wear: <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />,
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  anode: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export interface ShellInfo {
  baseline: string | null;      // null until the settings have loaded
  baselineTiles: number | null;
  totalTiles: number | null;
  frozen: string | null;        // commit of the rules-frozen tag
  modelChanged: boolean;        // the model file differs from the one under rules-frozen
}

export interface Crumb {
  label: ReactNode;
  href?: string;
}

export default function Shell({
  page,
  crumbs,
  info,
  wide = false,
  children,
}: {
  page: string;
  crumbs: Crumb[];
  info: ShellInfo;
  wide?: boolean;               // a full-bleed page (the anode lab): the crumbs don't sit in the 1180 px column
  children: ReactNode;
}) {
  const navItem = (key: string, label: string, icon: ReactNode, to: string, extra?: ReactNode) => (
    <a className={`nav ${page === key ? "on" : ""}`} href={to} aria-current={page === key ? "page" : undefined}>
      <NavIcon>{icon}</NavIcon>
      {label}
      {extra}
    </a>
  );
  return (
    <div className="cx flex min-h-screen items-stretch">
      <div className="print-hidden w-[236px] shrink-0 border-r border-cx-line bg-cx-sidebar">
        <aside className="sticky top-0 flex h-screen flex-col gap-7 overflow-y-auto px-3.5 py-5">
        <a href={href.identify()} className="flex items-center gap-2.5 px-2 py-1 text-cx-text-strong no-underline hover:text-cx-text-strong">
          <img src={CAT.mark} alt="Catalyst" width={30} height={30} />
          <span className="text-[19px] font-semibold tracking-[-0.02em]">catalyst</span>
        </a>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {navItem("identify", "Identify tile", ICONS.identify, href.identify())}
          {navItem("compare", "Compare batch", ICONS.compare, href.compare())}
          {navItem(
            "library",
            "Library",
            ICONS.library,
            href.library(),
            info.totalTiles != null && (
              <span className="mono ml-auto text-[11px] text-cx-faint" title={`${info.totalTiles} tiles`}>{info.totalTiles}</span>
            ),
          )}
          {navItem("audit", "Audit log", ICONS.audit, href.audit())}
          {(flagOn("impact") || flagOn("anode")) && <div className="lbl px-2.5 pt-6 pb-2">Experimental</div>}
          {flagOn("impact") && navItem("impact", "Wear & impact", ICONS.wear, href.impact())}
          {flagOn("anode") && navItem("anode", "Anode lab", ICONS.anode, href.anode())}
        </nav>
        <div className="mt-auto flex flex-col gap-2.5">
          {navItem("settings", "Settings", ICONS.settings, href.settings())}
          {info.baseline && (
            <a href={href.settings()} className="glass flex flex-col gap-1.5 rounded-[14px] p-3.5 text-inherit no-underline hover:bg-white/[0.06] hover:text-inherit">
              <div className="lbl">Baseline</div>
              <div className="flex items-center gap-2 text-sm font-medium text-cx-text">
                <BatchDot name={info.baseline} />
                {batchLabel(info.baseline)}
                {info.baselineTiles != null && (
                  <span className="ml-auto text-xs font-normal text-cx-faint">{info.baselineTiles} tiles</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs leading-snug text-cx-muted">
                {info.modelChanged ? (
                  <span className="text-cx-investigate-text">Model differs from the frozen one</span>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {ICONS.lock}
                    </svg>
                    {info.frozen ? (
                      <span title={`rules-frozen · ${shortHash(info.frozen, 7)}`}>Locked: rules frozen</span>
                    ) : (
                      "Rules not frozen yet"
                    )}
                  </>
                )}
              </div>
            </a>
          )}
        </div>
        </aside>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="print-hidden border-b border-cx-line">
          <nav aria-label="Breadcrumb" className={`flex min-h-16 flex-wrap items-center gap-3 px-10 text-sm text-cx-muted ${wide ? "" : "mx-auto w-full max-w-[1180px]"}`}>
            {crumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-3">
                {i > 0 && <span className="text-[#5F6166]">/</span>}
                {crumb.href && i < crumbs.length - 1 ? (
                  <a href={crumb.href} className="text-cx-muted no-underline hover:text-cx-text">{crumb.label}</a>
                ) : (
                  <span className={i === crumbs.length - 1 ? "text-cx-text" : undefined}>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        </header>
        {children}
      </main>
    </div>
  );
}
