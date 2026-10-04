// Design tokens from design/tokens.css, plus the video's layout constants.
export const C = {
  bg: "#0A0B0D",
  text: "#EDECE8",
  textStrong: "#F6F5F2",
  text2: "#C4C5C9",
  muted: "#A3A4A9",
  faint: "#8A8C92",
  line: "rgba(255,255,255,0.08)",
  grid: "rgba(255,255,255,0.032)",
  orange: "#FF7A2F",
  orangeText: "#FF9A5C",
  batch3: "#2DD4BF",
  batch1: "#6EA8FF",
  batch2: "#B794FF",
  accept: "#4ADE80",
  investigate: "#FACC15",
  reject: "#F87171",
  si: "#FF9A3C",
  pore: "#38BDF8",
  binder: "#C48CFF",
  cream: "#FFF0DC",
};

export const FONT = '"Geist", ui-sans-serif, system-ui, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", monospace';

export const W = 1920;
export const H = 1080;
export const FPS = 30;

// The floating browser window (PROMPT.md "Look").
export const WIN = { x: 260, y: 64, w: 1400, h: 820, title: 40, r: 16 };
export const CONTENT = { x: WIN.x, y: WIN.y + WIN.title, w: WIN.w, h: WIN.h - WIN.title };

// Caption band below the window.
export const CAPTION_Y = 990;

// The one motion language. UI and camera share SPRING; the window frame is softer; the cat bouncier.
export const SPRING = { damping: 22, stiffness: 120, mass: 0.9 };
export const SPRING_SOFT = { damping: 20, stiffness: 70, mass: 1 };
export const SPRING_CAT = { damping: 14, stiffness: 90, mass: 1 };
export const SPRING_POP = { damping: 12, stiffness: 180, mass: 0.7 };

// Window layouts: centred, or slid aside so hero type owns the other side.
export const FRAMES = {
  center: { dx: 0, scale: 1 },
  left: { dx: 96 + (WIN.w * 0.74) / 2 - W / 2, scale: 0.74 },
  right: { dx: W - 96 - (WIN.w * 0.74) / 2 - W / 2, scale: 0.74 },
} as const;
export const SAFE = { x: 96, y: 54 }; // 5 % safe margin

export const glass = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025))",
  backdropFilter: "blur(24px) saturate(160%)",
  WebkitBackdropFilter: "blur(24px) saturate(160%)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 24px 48px -24px rgba(0,0,0,0.7)",
} as const;

export const lbl = {
  fontFamily: MONO,
  fontSize: 13,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: C.faint,
} as const;
