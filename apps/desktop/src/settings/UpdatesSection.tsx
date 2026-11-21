import { getVersion } from "@tauri-apps/api/app";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { checkForUpdate, installUpdate, useUpdateState } from "../lib/updater";
import { useSettings } from "./SettingsProvider";

type SectionProps = { title: string; children: ReactNode };

/** Current version, "check on start", and manual check / install. */
export function UpdatesSection({ Section }: { Section: ComponentType<SectionProps> }) {
  const { updates, updateUpdates } = useSettings();
  const upd = useUpdateState();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <Section title="Updates">
      <div className="update-row">
        <span>
          Debutuuru <span className="mono">v{version ?? "…"}</span>
        </span>
        {upd.kind === "available" ? (
          <button className="primary" onClick={installUpdate}>
            <Download size={14} /> Install v{upd.version} and restart
          </button>
        ) : (
          <button onClick={() => checkForUpdate()} disabled={upd.kind === "checking" || upd.kind === "installing"}>
            {upd.kind === "checking" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Check for updates
          </button>
        )}
      </div>
      {upd.kind === "latest" && <p className="hint">You have the latest version.</p>}
      {upd.kind === "installing" && (
        <p className="hint">
          Downloading v{upd.version}
          {upd.percent !== null ? ` (${upd.percent}%)` : "…"} The app closes and opens again when it's installed.
        </p>
      )}
      {upd.kind === "available" && upd.notes && <pre className="update-notes">{upd.notes}</pre>}
      {upd.kind === "error" && <p className="note warn op-result-body">Couldn't update: {upd.message}</p>}
      <label className="check toggle-row">
        <input type="checkbox" checked={updates.check_on_start} onChange={(e) => updateUpdates({ check_on_start: e.target.checked })} />
        <span>
          Check for updates when the app starts
          <span className="hint block">Only checks and shows a button in the status bar; nothing is installed until you click it. Updates are signed and verified before installing.</span>
        </span>
      </label>
    </Section>
  );
}
