// xterm.js colors from the app's theme tokens, so terminals follow the theme
// and the styles (Gamer, Circuit). The 16 ANSI colors map to the status and
// syntax tokens, which share one perceived lightness, so programs' colors stay
// readable on every theme.
import type { ITheme } from "@xterm/xterm";

/** A CSS color in a form xterm.js parses (#rrggbb or rgba(…)). */
function normalize(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !color) return color;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  return ctx.fillStyle;
}

export function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => normalize(css.getPropertyValue(name).trim());
  return {
    // Transparent: the panel's background (and a background image) shows.
    background: "rgba(0, 0, 0, 0)",
    foreground: v("--text"),
    cursor: v("--accent"),
    cursorAccent: v("--bg-solid"),
    selectionBackground: v("--accent-ring"),
    selectionInactiveBackground: v("--accent-soft"),
    scrollbarSliderBackground: v("--border"),
    scrollbarSliderHoverBackground: v("--border-strong"),
    scrollbarSliderActiveBackground: v("--accent"),
    black: v("--bg-raised"),
    red: v("--danger"),
    green: v("--ok"),
    yellow: v("--warn"),
    blue: v("--info"),
    magenta: v("--syn-keyword"),
    cyan: v("--syn-type"),
    white: v("--text-muted"),
    brightBlack: v("--text-faint"),
    brightRed: v("--syn-property"),
    brightGreen: v("--syn-string"),
    brightYellow: v("--syn-constant"),
    brightBlue: v("--syn-function"),
    brightMagenta: v("--syn-keyword"),
    brightCyan: v("--syn-type"),
    brightWhite: v("--text"),
  };
}

/** Installed Nerd Fonts, tried after the app's font for prompt icons
 * (powerlevel10k, Starship, Oh My Posh) the main font doesn't have. */
const NERD_FONTS = ["Symbols Nerd Font Mono", "MesloLGS NF", "MesloLGS Nerd Font Mono", "JetBrainsMono Nerd Font Mono", "CaskaydiaCove Nerd Font Mono", "FiraCode Nerd Font Mono", "Hack Nerd Font Mono"];

export const terminalFont = () => {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  const generic = mono.match(/,\s*monospace\s*$/) ? "monospace" : "";
  const base = generic ? mono.replace(/,\s*monospace\s*$/, "") : mono;
  return [base, ...NERD_FONTS.map((f) => `"${f}"`), generic || "monospace"].join(", ");
};
