import { getVersion } from "@tauri-apps/api/app";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { checkForUpdate, installUpdate, useUpdateState } from "../lib/updater";
import { useSettings } from "./SettingsProvider";

type SectionProps = { title: string; children: ReactNode };

/** Current version, "check on start", and manual check / install. */
export function UpdatesSection({ Section }: { Section: ComponentType<SectionProps> }) {
  const { t } = useTranslation();
  const { updates, updateUpdates } = useSettings();
  const upd = useUpdateState();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <Section title={t("settings.updates.title")}>
      <div className="update-row">
        <span>
          Debutuuru <span className="mono">v{version ?? "…"}</span>
        </span>
        {upd.kind === "available" ? (
          <button className="primary" onClick={installUpdate}>
            <Download size={14} /> {t("settings.updates.install", { version: upd.version })}
          </button>
        ) : (
          <button onClick={() => checkForUpdate()} disabled={upd.kind === "checking" || upd.kind === "installing"}>
            {upd.kind === "checking" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {t("settings.updates.check")}
          </button>
        )}
      </div>
      {upd.kind === "latest" && <p className="hint">{t("settings.updates.latest")}</p>}
      {upd.kind === "installing" && (
        <p className="hint">
          {t("settings.updates.downloading", { version: upd.version })}
          {upd.percent !== null ? ` (${upd.percent}%)` : "…"} {t("settings.updates.restartNote")}
        </p>
      )}
      {upd.kind === "available" && upd.notes && <pre className="update-notes">{upd.notes}</pre>}
      {upd.kind === "error" && <p className="note warn op-result-body">{t("settings.updates.failed", { message: upd.message })}</p>}
      <label className="check toggle-row">
        <input type="checkbox" checked={updates.check_on_start} onChange={(e) => updateUpdates({ check_on_start: e.target.checked })} />
        <span>
          {t("settings.updates.checkOnStart")}
          <span className="hint block">{t("settings.updates.checkOnStartHint")}</span>
        </span>
      </label>
    </Section>
  );
}
