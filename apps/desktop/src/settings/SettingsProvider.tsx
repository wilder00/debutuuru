// Loads settings from the Rust side, applies them live (CSS variables) and
// saves changes debounced. Personalization never needs a restart.
import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Appearance } from "../bindings/Appearance";
import type { LoadedSettings } from "../bindings/LoadedSettings";
import { generateTheme, type ThemeReport } from "../theme/generate";
import { resolveInputs } from "../theme/presets";

type Ctx = {
  appearance: Appearance;
  backgroundPath: string | null;
  readOnly: boolean;
  notice: string | null;
  report: ThemeReport;
  update: (patch: Partial<Appearance>) => void;
  setBackground: (bg: Appearance["background"], path: string | null) => void;
  dismissNotice: () => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "debutuuru",
  custom: { base: "#101318", accent: "#5aa9ff", contrast: 50 },
  background: null,
  ui_font: null,
  mono_font: null,
  font_size: 13,
  ligatures: true,
  density: "compact",
};

/** Font names come from the user; keep only characters valid in a family name. */
const fontName = (s: string | null) => (s ? `"${s.replace(/[^\w\s.-]/g, "")}", ` : "");

function applyAppearance(a: Appearance, hasBackground: boolean): ThemeReport {
  const opacity = hasBackground && a.background ? a.background.opacity / 100 : 0;
  const { tokens, report } = generateTheme(resolveInputs(a.theme, a.custom), 1 - 0.45 * opacity);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(tokens)) root.setProperty(k, v);
  root.setProperty("--font-ui", `${fontName(a.ui_font)}"Inter Variable", system-ui, "Segoe UI", sans-serif`);
  root.setProperty(
    "--font-mono",
    `${fontName(a.mono_font)}"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace`,
  );
  root.setProperty("--font-size", `${a.font_size}px`);
  root.setProperty("--row-h", a.density === "compact" ? "26px" : "32px");
  root.setProperty("--code-ligatures", a.ligatures ? "normal" : "none");
  root.setProperty("--panel-blur", hasBackground ? "14px" : "0px");
  return report;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<LoadedSettings | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    invoke<LoadedSettings>("get_settings")
      .then((l) => {
        setLoaded(l);
        setAppearance(l.settings.appearance);
        setBackgroundPath(l.background_path);
        setNotice(l.notice);
      })
      .catch((e) => setNotice(`Couldn't load settings: ${e}`));
  }, []);

  const report = useMemo(() => applyAppearance(appearance, !!backgroundPath), [appearance, backgroundPath]);

  const persist = useCallback(
    (next: Appearance) => {
      if (!loaded || loaded.read_only) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        invoke<LoadedSettings>("save_settings", { settings: { ...loaded.settings, appearance: next } })
          .then((l) => setBackgroundPath(l.background_path))
          .catch((e) => setNotice(`Couldn't save settings: ${e}`));
      }, 300);
    },
    [loaded],
  );

  const update = useCallback(
    (patch: Partial<Appearance>) =>
      setAppearance((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      }),
    [persist],
  );

  const setBackground = useCallback(
    (bg: Appearance["background"], path: string | null) => {
      setBackgroundPath(path);
      update({ background: bg });
    },
    [update],
  );

  const value: Ctx = {
    appearance,
    backgroundPath,
    readOnly: loaded?.read_only ?? false,
    notice,
    report,
    update,
    setBackground,
    dismissNotice: () => setNotice(null),
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
