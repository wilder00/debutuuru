import { invoke } from "@tauri-apps/api/core";
import { Check, ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { ImportedBackground } from "../bindings/ImportedBackground";
import { LANGUAGES, systemLanguage } from "../i18n";
import { wslDistros } from "../lib/rpc";
import { generateTheme } from "../theme/generate";
import { CUSTOM, PRESETS, resolveInputs } from "../theme/presets";
import { useSettings } from "./SettingsProvider";
import { UpdatesSection } from "./UpdatesSection";
import { WslCommandSection } from "./WslCommandSection";

export function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { appearance: a, update, setBackground, backgroundPath, report, readOnly } = useSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = resolveInputs(a.theme, a.custom);

  async function pickImage(file: File) {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const img = await invoke<ImportedBackground>("import_background", bytes);
      setBackground({ file: img.file, opacity: a.background?.opacity ?? 60, blur: a.background?.blur ?? 0, dim: a.background?.dim ?? 45 }, img.path);
    } catch (e) {
      setError(String(e));
    }
  }

  const setBg = (patch: Partial<NonNullable<typeof a.background>>) =>
    a.background && update({ background: { ...a.background, ...patch } });

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={t("settings.title")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="drawer-head">
          <h2>{t("settings.title")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("common.close")} autoFocus>
            <X size={16} />
          </button>
        </header>
        {readOnly && <p className="note warn">{t("settings.readOnly")}</p>}

        <LanguageSection />

        <Section title={t("settings.theme.title")}>
          <div className="theme-grid">
            {PRESETS.map((p) => (
              <ThemeCard key={p.id} name={t(`settings.theme.presets.${p.id}` as "settings.theme.presets.debutuuru", { defaultValue: p.name })} inputs={p.inputs} active={a.theme === p.id} onClick={() => update({ theme: p.id })} />
            ))}
            <ThemeCard name={t("settings.theme.custom")} inputs={a.custom} active={a.theme === CUSTOM} onClick={() => update({ theme: CUSTOM, custom: inputs })} />
          </div>
          {a.theme === CUSTOM && (
            <div className="field-grid">
              <label>
                {t("settings.theme.base")}
                <input type="color" value={a.custom.base} onChange={(e) => update({ custom: { ...a.custom, base: e.target.value } })} />
              </label>
              <label>
                {t("settings.theme.accent")}
                <input type="color" value={a.custom.accent} onChange={(e) => update({ custom: { ...a.custom, accent: e.target.value } })} />
              </label>
              <Slider label={t("settings.theme.contrast")} value={a.custom.contrast} max={100} onChange={(v) => update({ custom: { ...a.custom, contrast: v } })} />
            </div>
          )}
          <p className="contrast-report">
            {t("settings.theme.textContrast")} <Ratio value={report.text} target={7} /> · {t("settings.theme.secondary")} <Ratio value={report.muted} target={4.5} /> ·{" "}
            {t("settings.theme.buttons")}{" "}
            <Ratio value={report.onAccent} target={4.5} />
          </p>
        </Section>

        <Section title={t("settings.style.title")}>
          <div className="segmented" role="radiogroup" aria-label={t("settings.style.title")}>
            {(["standard", "gamer", "circuit"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={a.style === s} className={a.style === s ? "on" : ""} onClick={() => update({ style: s })}>
                {t(`settings.style.${s}`)}
              </button>
            ))}
          </div>
          {a.style !== "standard" && (
            <label className="check toggle-row">
              <input type="checkbox" checked={a.rgb_animation} onChange={(e) => update({ rgb_animation: e.target.checked })} />
              <span>
                {t("settings.style.rgb")}
                <span className="hint block">{t("settings.style.rgbHint")}</span>
              </span>
            </label>
          )}
          <p className="hint">{t("settings.style.hint")}</p>
        </Section>

        <Section title={t("settings.background.title")}>
          <div className="row-actions">
            <button onClick={() => fileInput.current?.click()}>
              <ImagePlus size={14} /> {a.background ? t("settings.background.change") : t("settings.background.choose")}
            </button>
            {a.background && (
              <button onClick={() => setBackground(null, null)}>
                <Trash2 size={14} /> {t("settings.background.remove")}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImage(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && <p className="note danger">{error}</p>}
          {a.background && backgroundPath && (
            <div className="field-grid">
              <Slider label={t("settings.background.visibility")} value={a.background.opacity} max={100} unit="%" onChange={(v) => setBg({ opacity: v })} />
              <Slider label={t("settings.background.blur")} value={a.background.blur} max={40} unit="px" onChange={(v) => setBg({ blur: v })} />
              <Slider label={t("settings.background.dim")} value={a.background.dim} max={90} unit="%" onChange={(v) => setBg({ dim: v })} />
            </div>
          )}
          <p className="hint">{t("settings.background.hint")}</p>
        </Section>

        <Section title={t("settings.text.title")}>
          <div className="field-grid">
            <label>
              {t("settings.text.uiFont")}
              <input placeholder={t("settings.text.uiFontPlaceholder")} value={a.ui_font ?? ""} onChange={(e) => update({ ui_font: e.target.value || null })} />
            </label>
            <label>
              {t("settings.text.codeFont")}
              <input
                placeholder={t("settings.text.codeFontPlaceholder")}
                value={a.mono_font ?? ""}
                onChange={(e) => update({ mono_font: e.target.value || null })}
              />
            </label>
            <Slider label={t("settings.text.size")} value={a.font_size} min={12} max={16} unit="px" onChange={(v) => update({ font_size: v })} />
            <label className="check">
              <input type="checkbox" checked={a.ligatures} onChange={(e) => update({ ligatures: e.target.checked })} />
              {t("settings.text.ligatures")}
            </label>
          </div>
        </Section>

        <Section title={t("settings.density.title")}>
          <div className="segmented" role="radiogroup">
            {(["compact", "comfortable"] as const).map((d) => (
              <button key={d} role="radio" aria-checked={a.density === d} className={a.density === d ? "on" : ""} onClick={() => update({ density: d })}>
                {t(`settings.density.${d}`)}
              </button>
            ))}
          </div>
        </Section>

        <GitSshSection />
        <WslCommandSection Section={Section} />
        <UpdatesSection Section={Section} />
      </aside>
    </div>
  );
}

/** How Windows repositories authenticate over SSH. WSL repos always use their
 *  own distro's ssh, keys and ssh-agent, so nothing to configure for them. */
/** UI language: follow the system (default) or a fixed one. Names are shown
 *  in their own language, so anyone can find theirs. */
function LanguageSection() {
  const { t } = useTranslation();
  const { language, updateLanguage } = useSettings();
  const system = LANGUAGES.find((l) => l.code === systemLanguage())?.name ?? "English";
  return (
    <Section title={t("settings.language.title")}>
      <div className="field-grid">
        <label>
          <select value={language ?? ""} aria-label={t("settings.language.title")} onChange={(e) => updateLanguage(e.target.value || null)}>
            <option value="">{t("settings.language.system", { language: system })}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">{t("settings.language.hint")}</p>
    </Section>
  );
}

function GitSshSection() {
  const { t } = useTranslation();
  const { git: g, updateGit } = useSettings();
  const [distros, setDistros] = useState<string[]>([]);
  useEffect(() => {
    wslDistros().then(setDistros).catch(() => {});
  }, []);
  if (!navigator.userAgent.includes("Windows")) return null;
  return (
    <Section title={t("settings.ssh.title")}>
      <label className="check toggle-row">
        <input
          type="checkbox"
          checked={g.windows_ssh === "wsl"}
          disabled={distros.length === 0}
          onChange={(e) => updateGit({ windows_ssh: e.target.checked ? "wsl" : "system" })}
        />
        <span>
          {t("settings.ssh.useWslKeys")}
          <span className="hint block">
            <Trans i18nKey="settings.ssh.useWslKeysHint" components={{ code: <code className="mono" /> }} />
          </span>
        </span>
      </label>
      {g.windows_ssh === "wsl" && distros.length > 1 && (
        <div className="field-grid">
          <label>
            {t("settings.ssh.distro")}
            <select value={g.wsl_distro ?? ""} onChange={(e) => updateGit({ wsl_distro: e.target.value || null })}>
              <option value="">{t("settings.ssh.defaultDistro")}</option>
              {distros.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {distros.length === 0 && <p className="hint">{t("settings.ssh.noDistro")}</p>}
      <p className="hint">{t("settings.ssh.wslReposHint")}</p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ThemeCard({ name, inputs, active, onClick }: { name: string; inputs: Parameters<typeof generateTheme>[0]; active: boolean; onClick: () => void }) {
  const { scale } = generateTheme(inputs);
  const [bg, panel, , , , , , , accent, , muted, text] = scale;
  return (
    <button className={"theme-card" + (active ? " on" : "")} onClick={onClick} aria-pressed={active}>
      <span className="theme-preview" style={{ background: bg }}>
        <span style={{ background: panel, borderColor: scale[6] }} className="tp-side" />
        <span className="tp-lines">
          <i style={{ background: text }} />
          <i style={{ background: muted }} />
          <i style={{ background: accent }} />
        </span>
      </span>
      <span className="theme-name">
        {name}
        {active && <Check size={12} />}
      </span>
    </button>
  );
}

function Slider(p: { label: string; value: number; min?: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label>
      <span className="slider-label">
        {p.label}
        <span className="mono">
          {p.value}
          {p.unit}
        </span>
      </span>
      <input type="range" min={p.min ?? 0} max={p.max} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

function Ratio({ value, target }: { value: number; target: number }) {
  const { t } = useTranslation();
  return (
    <span className={"mono " + (value >= target ? "ok" : "danger")} title={t("settings.theme.target", { target })}>
      {value.toFixed(1)}:1
    </span>
  );
}
