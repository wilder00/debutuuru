// Settings › Terminal: which profile new terminals use, and the user's own
// profiles (name, program, arguments, folder, environment). Detected shells
// are listed for reference; they aren't stored.
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TerminalProfile } from "../bindings/TerminalProfile";
import { guessIcon, ICON_NAMES, iconTitle, ProfileIcon } from "../modules/term/icons";
import { detectedProfiles, pickDefault } from "../modules/term/profiles";
import { useSettings } from "./SettingsProvider";

type SectionProps = { title: string; children: ReactNode };

/** "a b \"c d\"" → ["a", "b", "c d"]. */
const splitArgs = (s: string) => [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const joinArgs = (a: string[]) => a.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");
const envText = (e: Record<string, string>) =>
  Object.entries(e)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
const parseEnv = (s: string) =>
  Object.fromEntries(
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1)]),
  );

export function TerminalSection({ Section }: { Section: ComponentType<SectionProps> }) {
  const { t } = useTranslation();
  const { terminal, updateTerminal } = useSettings();
  const [detected, setDetected] = useState<TerminalProfile[]>([]);
  useEffect(() => {
    void detectedProfiles().then(setDetected);
  }, []);
  const all = [...detected, ...terminal.profiles];
  const current = pickDefault(all, terminal.default_profile);

  const setProfile = (id: string, patch: Partial<TerminalProfile>) =>
    updateTerminal({ profiles: terminal.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addProfile = () =>
    updateTerminal({
      profiles: [
        ...terminal.profiles,
        { id: `custom:${Date.now().toString(36)}`, name: t("settings.terminal.newProfile"), program: "", args: [], cwd: null, env: {}, wsl_distro: null, icon: null },
      ],
    });
  const removeProfile = (id: string) =>
    updateTerminal({
      profiles: terminal.profiles.filter((p) => p.id !== id),
      default_profile: terminal.default_profile === id ? null : terminal.default_profile,
    });

  return (
    <Section title={t("settings.terminal.title")}>
      <div className="field-grid">
        <label>
          {t("settings.terminal.default")}
          <select value={current?.id ?? ""} onChange={(e) => updateTerminal({ default_profile: e.target.value || null })}>
            {all.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">{t("settings.terminal.detected", { list: detected.map((p) => p.name).join(", ") || "—" })}</p>
      {terminal.profiles.map((p) => (
        <div key={p.id} className="profile-card">
          <div className="field-grid">
            <label>
              {t("settings.terminal.name")}
              <input value={p.name} onChange={(e) => setProfile(p.id, { name: e.target.value })} />
            </label>
            <label>
              {t("settings.terminal.program")}
              <input className="mono" value={p.program} placeholder="pwsh.exe, /bin/zsh, wsl.exe…" onChange={(e) => setProfile(p.id, { program: e.target.value })} />
            </label>
            <label>
              {t("settings.terminal.args")}
              <input className="mono" value={joinArgs(p.args)} placeholder="-NoLogo" onChange={(e) => setProfile(p.id, { args: splitArgs(e.target.value) })} />
            </label>
            <label>
              {t("settings.terminal.icon")}
              <span className="icon-select">
                <ProfileIcon profile={p} size={16} />
                <select value={p.icon ?? ""} onChange={(e) => setProfile(p.id, { icon: e.target.value || null })}>
                  <option value="">{t("settings.terminal.iconAuto", { name: iconTitle(guessIcon(p)) ?? t("settings.terminal.iconGeneric") })}</option>
                  {ICON_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {iconTitle(n) ?? t("settings.terminal.iconGeneric")}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label>
              {t("settings.terminal.cwd")}
              <input className="mono" value={p.cwd ?? ""} placeholder={t("settings.terminal.cwdHint")} onChange={(e) => setProfile(p.id, { cwd: e.target.value || null })} />
            </label>
          </div>
          <label className="block-field">
            {t("settings.terminal.env")}
            <textarea className="mono" rows={2} defaultValue={envText(p.env)} placeholder="NAME=value" onBlur={(e) => setProfile(p.id, { env: parseEnv(e.target.value) })} />
          </label>
          <button onClick={() => removeProfile(p.id)}>
            <Trash2 size={14} /> {t("settings.terminal.remove")}
          </button>
        </div>
      ))}
      <button onClick={addProfile}>
        <Plus size={14} /> {t("settings.terminal.add")}
      </button>
    </Section>
  );
}
