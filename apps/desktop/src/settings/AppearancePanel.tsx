import { invoke } from "@tauri-apps/api/core";
import { Check, ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImportedBackground } from "../bindings/ImportedBackground";
import { wslDistros } from "../lib/rpc";
import { generateTheme } from "../theme/generate";
import { CUSTOM, PRESETS, resolveInputs } from "../theme/presets";
import { useSettings } from "./SettingsProvider";
import { UpdatesSection } from "./UpdatesSection";
import { WslCommandSection } from "./WslCommandSection";

export function AppearancePanel({ onClose }: { onClose: () => void }) {
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
      <aside className="drawer" role="dialog" aria-label="Settings" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)" autoFocus>
            <X size={16} />
          </button>
        </header>
        {readOnly && <p className="note warn">Settings come from a newer version; changes apply now but won't be saved.</p>}

        <Section title="Theme">
          <div className="theme-grid">
            {PRESETS.map((p) => (
              <ThemeCard key={p.id} name={p.name} inputs={p.inputs} active={a.theme === p.id} onClick={() => update({ theme: p.id })} />
            ))}
            <ThemeCard name="Custom" inputs={a.custom} active={a.theme === CUSTOM} onClick={() => update({ theme: CUSTOM, custom: inputs })} />
          </div>
          {a.theme === CUSTOM && (
            <div className="field-grid">
              <label>
                Base
                <input type="color" value={a.custom.base} onChange={(e) => update({ custom: { ...a.custom, base: e.target.value } })} />
              </label>
              <label>
                Accent
                <input type="color" value={a.custom.accent} onChange={(e) => update({ custom: { ...a.custom, accent: e.target.value } })} />
              </label>
              <Slider label="Contrast" value={a.custom.contrast} max={100} onChange={(v) => update({ custom: { ...a.custom, contrast: v } })} />
            </div>
          )}
          <p className="contrast-report">
            Text contrast <Ratio value={report.text} target={7} /> · secondary <Ratio value={report.muted} target={4.5} /> · buttons{" "}
            <Ratio value={report.onAccent} target={4.5} />
          </p>
        </Section>

        <Section title="Background image">
          <div className="row-actions">
            <button onClick={() => fileInput.current?.click()}>
              <ImagePlus size={14} /> {a.background ? "Change image" : "Choose image"}
            </button>
            {a.background && (
              <button onClick={() => setBackground(null, null)}>
                <Trash2 size={14} /> Remove
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
              <Slider label="Visibility" value={a.background.opacity} max={100} unit="%" onChange={(v) => setBg({ opacity: v })} />
              <Slider label="Blur" value={a.background.blur} max={40} unit="px" onChange={(v) => setBg({ blur: v })} />
              <Slider label="Dim" value={a.background.dim} max={90} unit="%" onChange={(v) => setBg({ dim: v })} />
            </div>
          )}
          <p className="hint">The image is copied into Debutuuru's data folder. Panels turn translucent so it shows through.</p>
        </Section>

        <Section title="Text">
          <div className="field-grid">
            <label>
              UI font
              <input placeholder="Inter (bundled)" value={a.ui_font ?? ""} onChange={(e) => update({ ui_font: e.target.value || null })} />
            </label>
            <label>
              Code font
              <input
                placeholder="JetBrains Mono (bundled)"
                value={a.mono_font ?? ""}
                onChange={(e) => update({ mono_font: e.target.value || null })}
              />
            </label>
            <Slider label="Size" value={a.font_size} min={12} max={16} unit="px" onChange={(v) => update({ font_size: v })} />
            <label className="check">
              <input type="checkbox" checked={a.ligatures} onChange={(e) => update({ ligatures: e.target.checked })} />
              Code ligatures
            </label>
          </div>
        </Section>

        <Section title="Density">
          <div className="segmented" role="radiogroup">
            {(["compact", "comfortable"] as const).map((d) => (
              <button key={d} role="radio" aria-checked={a.density === d} className={a.density === d ? "on" : ""} onClick={() => update({ density: d })}>
                {d[0].toUpperCase() + d.slice(1)}
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
function GitSshSection() {
  const { git: g, updateGit } = useSettings();
  const [distros, setDistros] = useState<string[]>([]);
  useEffect(() => {
    wslDistros().then(setDistros).catch(() => {});
  }, []);
  if (!navigator.userAgent.includes("Windows")) return null;
  return (
    <Section title="Git & SSH">
      <label className="check toggle-row">
        <input
          type="checkbox"
          checked={g.windows_ssh === "wsl"}
          disabled={distros.length === 0}
          onChange={(e) => updateGit({ windows_ssh: e.target.checked ? "wsl" : "system" })}
        />
        <span>
          Use WSL's SSH keys for Windows repositories
          <span className="hint block">
            Push/pull of Windows repos runs <code className="mono">wsl.exe -e ssh</code>, so the keys, ssh-agent and <code className="mono">~/.ssh/config</code> from
            your distro work here too. Off: your normal Git for Windows setup (keys in <code className="mono">%USERPROFILE%\.ssh</code>, Credential Manager for
            HTTPS).
          </span>
        </span>
      </label>
      {g.windows_ssh === "wsl" && distros.length > 1 && (
        <div className="field-grid">
          <label>
            Distro
            <select value={g.wsl_distro ?? ""} onChange={(e) => updateGit({ wsl_distro: e.target.value || null })}>
              <option value="">Default distro</option>
              {distros.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {distros.length === 0 && <p className="hint">No WSL distro found.</p>}
      <p className="hint">Repositories inside WSL always use that distro's own ssh. Passwordless keys and ssh-agent need no setup; when a passphrase or password is needed, Debutuuru asks in a dialog and never stores it.</p>
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
  return (
    <span className={"mono " + (value >= target ? "ok" : "danger")} title={`target ≥ ${target}:1 (WCAG)`}>
      {value.toFixed(1)}:1
    </span>
  );
}
