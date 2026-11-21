// Generates every UI color token from 3 inputs (base, accent, contrast),
// following docs/DESIGN.md: a 12-step neutral scale with fixed meanings,
// lighter surfaces for higher elevation, desaturated accents, and status/lane
// colors at equal perceived lightness.
import type { ThemeInputs } from "../bindings/ThemeInputs";
import { clamp, contrastRatio, hexToOklch, oklch, withAlpha } from "./color";

export type Tokens = Record<string, string>;

export type ThemeReport = {
  /** Primary text on panels. Target ≥ 7 (AAA body text). */
  text: number;
  /** Secondary text on panels. Target ≥ 4.5 (AA body text). */
  muted: number;
  /** Text on the accent (buttons). Target ≥ 4.5. */
  onAccent: number;
};

export type Generated = { tokens: Tokens; report: ThemeReport; scale: string[] };

/**
 * @param surfaceAlpha 1 = opaque panels. Lower when a background image is set,
 *   so the image shows through (with backdrop blur).
 */
export function generateTheme(inputs: ThemeInputs, surfaceAlpha = 1): Generated {
  const k = clamp(inputs.contrast, 0, 100) / 100; // 0 soft … 1 high contrast
  const base = hexToOklch(inputs.base);
  const accent = hexToOklch(inputs.accent);

  // Dark mode: keep the base dark, with a hint of its hue (never pure black).
  const L1 = clamp(base.l, 0.12, 0.3);
  const C = Math.min(base.c, 0.035);
  const H = base.h;

  // Steps 1–8: backgrounds, components, borders. Spread grows with contrast.
  const spread = 0.8 + 0.6 * k;
  const deltas = [0, 0.025, 0.05, 0.075, 0.1, 0.13, 0.17, 0.23].map((d) => d * spread);
  const neutral = deltas.map((d, i) => oklch(L1 + d, C * (1 - i * 0.06), H));
  // Steps 11–12: text. Slight tint toward the base hue reads as "designed".
  const muted = oklch(0.7 + 0.1 * k, Math.min(C, 0.02), H);
  const text = oklch(0.92 + 0.06 * k, Math.min(C, 0.012), H);

  // Accent (steps 9–10): desaturated so it never vibrates on dark surfaces.
  const aL = clamp(accent.l, 0.62, 0.8);
  const aC = Math.min(accent.c, 0.17);
  const acc = oklch(aL, aC, accent.h);
  const accHover = oklch(aL + 0.05, aC, accent.h);
  const onAccent = aL > 0.7 ? oklch(0.18, 0.02, accent.h) : "#ffffff";

  // Status colors share lightness/chroma, so none shouts louder than another.
  const status = (h: number) => oklch(0.76 + 0.04 * k, 0.14, h);

  // Graph lanes: 8 hues rotated from the accent, equal lightness.
  const lanes = Array.from({ length: 8 }, (_, i) => oklch(0.74 + 0.04 * k, 0.13, (accent.h + i * 45) % 360));

  const a = clamp(surfaceAlpha, 0, 1);
  const tokens: Tokens = {
    "--bg-app": withAlpha(neutral[0], a),
    "--bg-panel": withAlpha(neutral[1], a),
    "--bg-raised": withAlpha(neutral[2], Math.min(1, a + 0.15)),
    "--bg-hover": withAlpha(neutral[3], Math.min(1, a + 0.2)),
    "--bg-active": withAlpha(neutral[4], Math.min(1, a + 0.25)),
    "--bg-solid": neutral[0],
    "--border-subtle": withAlpha(neutral[5], 0.7),
    "--border": neutral[6],
    "--border-strong": neutral[7],
    "--accent": acc,
    "--accent-hover": accHover,
    "--accent-soft": withAlpha(acc, 0.16),
    "--accent-ring": withAlpha(acc, 0.55),
    "--on-accent": onAccent,
    "--text": text,
    "--text-muted": muted,
    "--text-faint": withAlpha(muted, 0.7),
    "--ok": status(150),
    "--warn": status(80),
    "--danger": status(25),
    "--info": status(245),
    "--shadow": `0 8px 24px ${withAlpha("#000000", 0.35 + 0.15 * k)}`,
  };
  lanes.forEach((c, i) => (tokens[`--lane-${i}`] = c));

  // Syntax: equal lightness like the lanes, fixed hues by convention (purple
  // keywords, green strings…) so code reads the same across themes.
  const syn = (h: number) => oklch(0.8 + 0.04 * k, 0.12, h);
  Object.assign(tokens, {
    "--syn-keyword": syn(305),
    "--syn-string": syn(145),
    "--syn-number": syn(55),
    "--syn-constant": syn(80),
    "--syn-function": syn(250),
    "--syn-type": syn(195),
    "--syn-property": syn(20),
    "--syn-comment": withAlpha(muted, 0.85),
  });

  const report: ThemeReport = {
    text: contrastRatio(text, neutral[1]),
    muted: contrastRatio(muted, neutral[1]),
    onAccent: contrastRatio(onAccent, acc),
  };
  return { tokens, report, scale: [...neutral, acc, accHover, muted, text] };
}

export const LANE_COUNT = 8;
