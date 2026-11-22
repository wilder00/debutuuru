// Loads settings from the Rust side, applies them live (CSS variables) and
// saves changes debounced. Personalization never needs a restart.
import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Appearance } from "../bindings/Appearance";
import type { DiffSettings } from "../bindings/DiffSettings";
import type { TerminalSettings } from "../bindings/TerminalSettings";
import type { GitSettings } from "../bindings/GitSettings";
import type { LoadedSettings } from "../bindings/LoadedSettings";
import type { Session } from "../bindings/Session";
import type { Settings } from "../bindings/Settings";
import type { UpdateSettings } from "../bindings/UpdateSettings";
import i18n, { resolveLanguage } from "../i18n";
import { generateTheme, type ThemeReport } from "../theme/generate";
import { resolveInputs } from "../theme/presets";

type Ctx = {
  /** False until the settings file was read (don't restore tabs before). */
  ready: boolean;
  appearance: Appearance;
  session: Session;
  git: GitSettings;
  updates: UpdateSettings;
  /** Saved UI language; `null` follows the system. */
  language: string | null;
  diff: DiffSettings;
  terminal: TerminalSettings;
  backgroundPath: string | null;
  readOnly: boolean;
  notice: string | null;
  report: ThemeReport;
  update: (patch: Partial<Appearance>) => void;
  updateSession: (session: Session) => void;
  updateGit: (patch: Partial<GitSettings>) => void;
  updateUpdates: (patch: Partial<UpdateSettings>) => void;
  updateLanguage: (language: string | null) => void;
  updateDiff: (patch: Partial<DiffSettings>) => void;
  updateTerminal: (patch: Partial<TerminalSettings>) => void;
  setBackground: (bg: Appearance["background"], path: string | null) => void;
  dismissNotice: () => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export const DEFAULT_SETTINGS: Settings = {
  schema_version: 1,
  appearance: {
    theme: "debutuuru",
    custom: { base: "#101318", accent: "#5aa9ff", contrast: 50 },
    background: null,
    ui_font: null,
    mono_font: null,
    font_size: 13,
    ligatures: true,
    density: "compact",
    style: "standard",
    rgb_animation: true,
  },
  session: { open_repos: [], active: null, recent_repos: [] },
  git: { windows_ssh: "system", wsl_distro: null },
  updates: { check_on_start: true },
  language: null,
  diff: { layout: "unified", word_highlight: true, ignore_whitespace: false, context_lines: 3, syntax_highlight: true, wrap_lines: false },
  terminal: { default_profile: null, profiles: [], panel_height: 280 },
};

/** Font names come from the user; keep only characters valid in a family name. */
const fontName = (s: string | null) => (s ? `"${s.replace(/[^\w\s.-]/g, "")}", ` : "");

function applyAppearance(a: Appearance, hasBackground: boolean): ThemeReport {
  const opacity = hasBackground && a.background ? a.background.opacity / 100 : 0;
  const { tokens, report } = generateTheme(resolveInputs(a.theme, a.custom), 1 - 0.45 * opacity);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(tokens)) root.setProperty(k, v);
  root.setProperty("--font-ui", `${fontName(a.ui_font)}"Inter Variable", var(--font-cjk), system-ui, "Segoe UI", sans-serif`);
  root.setProperty("--font-mono", `${fontName(a.mono_font)}"JetBrains Mono Variable", "Cascadia Code", Consolas, var(--font-cjk), monospace`);
  root.setProperty("--font-size", `${a.font_size}px`);
  root.setProperty("--row-h", a.density === "compact" ? "26px" : "32px");
  root.setProperty("--code-ligatures", a.ligatures ? "normal" : "none");
  // No extra blur on panels over a background image: it made the side panels
  // look like a separate frosted layer next to the sharp center. The image's
  // own Blur setting blurs it evenly behind the whole window instead.
  root.setProperty("--panel-blur", "0px");
  // The style is pure CSS (styles.css › [data-style="gamer"]).
  document.documentElement.dataset.style = a.style;
  document.documentElement.dataset.rgb = a.rgb_animation ? "on" : "off";
  return report;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const canSave = useRef(false);

  useEffect(() => {
    invoke<LoadedSettings>("get_settings")
      .then((l) => {
        setSettings(l.settings);
        setBackgroundPath(l.background_path);
        setNotice(l.notice);
        setReadOnly(l.read_only);
        canSave.current = !l.read_only;
      })
      .catch((e) => setNotice(i18n.t("app.loadSettingsFailed", { error: String(e) })))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(resolveLanguage(settings.language));
  }, [settings.language]);

  const report = useMemo(() => applyAppearance(settings.appearance, !!backgroundPath), [settings.appearance, backgroundPath]);

  const persist = useCallback((next: Settings) => {
    if (!canSave.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      invoke<LoadedSettings>("save_settings", { settings: next })
        .then((l) => setBackgroundPath(l.background_path))
        .catch((e) => setNotice(i18n.t("app.saveSettingsFailed", { error: String(e) })));
    }, 300);
  }, []);

  const change = useCallback(
    (fn: (s: Settings) => Settings) =>
      setSettings((prev) => {
        const next = fn(prev);
        persist(next);
        return next;
      }),
    [persist],
  );

  const update = useCallback((patch: Partial<Appearance>) => change((s) => ({ ...s, appearance: { ...s.appearance, ...patch } })), [change]);
  const updateSession = useCallback((session: Session) => change((s) => ({ ...s, session })), [change]);
  const updateGit = useCallback((patch: Partial<GitSettings>) => change((s) => ({ ...s, git: { ...s.git, ...patch } })), [change]);
  const updateUpdates = useCallback(
    (patch: Partial<UpdateSettings>) => change((s) => ({ ...s, updates: { ...s.updates, ...patch } })),
    [change],
  );
  const updateLanguage = useCallback((language: string | null) => change((s) => ({ ...s, language })), [change]);
  const updateDiff = useCallback((patch: Partial<DiffSettings>) => change((s) => ({ ...s, diff: { ...s.diff, ...patch } })), [change]);
  const updateTerminal = useCallback(
    (patch: Partial<TerminalSettings>) => change((s) => ({ ...s, terminal: { ...s.terminal, ...patch } })),
    [change],
  );
  const setBackground = useCallback(
    (bg: Appearance["background"], path: string | null) => {
      setBackgroundPath(path);
      update({ background: bg });
    },
    [update],
  );

  const value: Ctx = {
    ready,
    appearance: settings.appearance,
    session: settings.session,
    git: settings.git,
    updates: settings.updates,
    language: settings.language,
    diff: settings.diff,
    terminal: settings.terminal,
    backgroundPath,
    readOnly,
    notice,
    report,
    update,
    updateSession,
    updateGit,
    updateUpdates,
    updateLanguage,
    updateDiff,
    updateTerminal,
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
