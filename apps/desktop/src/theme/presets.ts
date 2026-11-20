import type { ThemeInputs } from "../bindings/ThemeInputs";

export type Preset = { id: string; name: string; inputs: ThemeInputs };

// Each preset is just the 3 generator inputs. Contrast ≥ 40 keeps secondary
// text above WCAG AA; "High contrast" targets AAA everywhere.
export const PRESETS: Preset[] = [
  { id: "debutuuru", name: "Debutuuru", inputs: { base: "#101318", accent: "#5aa9ff", contrast: 50 } },
  { id: "midnight", name: "Midnight", inputs: { base: "#0d1021", accent: "#8b9cff", contrast: 50 } },
  { id: "graphite", name: "Graphite", inputs: { base: "#141414", accent: "#c4a7ff", contrast: 45 } },
  { id: "forest", name: "Forest", inputs: { base: "#0e1512", accent: "#4fd1a1", contrast: 50 } },
  { id: "ember", name: "Ember", inputs: { base: "#16110f", accent: "#ff9b5e", contrast: 50 } },
  { id: "rose", name: "Rosé", inputs: { base: "#161016", accent: "#f28fbd", contrast: 50 } },
  { id: "high-contrast", name: "High contrast", inputs: { base: "#0a0a0a", accent: "#ffd166", contrast: 100 } },
];

export const CUSTOM = "custom";

export function resolveInputs(theme: string, custom: ThemeInputs): ThemeInputs {
  if (theme === CUSTOM) return custom;
  return (PRESETS.find((p) => p.id === theme) ?? PRESETS[0]).inputs;
}
