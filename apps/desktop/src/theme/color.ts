// sRGB <-> OKLCH (Björn Ottosson's OKLab), plus WCAG contrast.
// OKLCH is perceptual: equal L looks equally bright for every hue, which is
// what lets a theme be generated from a few inputs (see docs/DESIGN.md).

export type Oklch = { l: number; c: number; h: number };
type Rgb = [number, number, number]; // 0..1, gamma-encoded sRGB

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Converts to sRGB, lowering chroma (keeping hue and lightness) until it fits. */
export function oklchToRgb(color: Oklch): Rgb {
  let lo = 0;
  let hi = color.c;
  let lin = oklchToLinear(color);
  if (!inGamut(lin)) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear({ ...color, c: lo });
  }
  return lin.map((v) => toGamma(Math.min(1, Math.max(0, v)))) as Rgb;
}

export const oklch = (l: number, c: number, h: number) => rgbToHex(oklchToRgb({ l: clamp(l, 0, 1), c: Math.max(0, c), h }));
export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `#rrggbb` + alpha (0..1) → `rgb(r g b / a)` */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
  return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1).toFixed(3)})`;
}

/** WCAG 2 contrast ratio between two opaque colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
