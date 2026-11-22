// Settings › WSL command: makes `debutuuru .` work inside each WSL distro
// without having to open a WSL repo from the app first.
import { useEffect, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import i18n from "../i18n";
import type { WslCommandStatus } from "../bindings/WslCommandStatus";
import { wslAddToPath, wslCommandStatus, wslDistros, wslInstallCommand, wslRunning } from "../lib/rpc";

type Row =
  | { kind: "idle" } // distro not running: checked only on request (it would boot it)
  | { kind: "busy"; label: string }
  | { kind: "error"; message: string }
  | { kind: "status"; status: WslCommandStatus };

export function WslCommandSection({ Section }: { Section: (p: { title: string; children: ReactNode }) => ReactNode }) {
  const { t } = useTranslation();
  const [distros, setDistros] = useState<string[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const set = (d: string, r: Row) => setRows((all) => ({ ...all, [d]: r }));

  const run = (d: string, label: string, op: (d: string) => Promise<WslCommandStatus>) => {
    set(d, { kind: "busy", label });
    op(d).then(
      (status) => set(d, { kind: "status", status }),
      (e: unknown) => set(d, { kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  };

  useEffect(() => {
    Promise.all([wslDistros(), wslRunning()])
      .then(([all, running]) => {
        setDistros(all);
        for (const d of all) {
          if (running.includes(d)) run(d, i18n.t("settings.wslCommand.checking"), wslCommandStatus);
          else set(d, { kind: "idle" });
        }
      })
      .catch(() => setDistros([]));
  }, []);

  if (!navigator.userAgent.includes("Windows") || !distros?.length) return null;
  return (
    <Section title={t("settings.wslCommand.title")}>
      <p className="hint">
        <Trans i18nKey="settings.wslCommand.hint" components={{ code: <code className="mono" /> }} />
      </p>
      <ul className="wsl-rows">
        {distros.map((d) => (
          <li key={d} className="wsl-row">
            <span className="wsl-name">{d}</span>
            <DistroState
              row={rows[d] ?? { kind: "idle" }}
              onCheck={() => run(d, t("settings.wslCommand.checking"), wslCommandStatus)}
              onInstall={() => run(d, t("settings.wslCommand.installing"), wslInstallCommand)}
              onAddToPath={() => run(d, t("settings.wslCommand.updating"), wslAddToPath)}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DistroState(p: { row: Row; onCheck: () => void; onInstall: () => void; onAddToPath: () => void }) {
  const { row } = p;
  const { t } = useTranslation();
  const code = { code: <code className="mono" /> };
  if (row.kind === "idle")
    return (
      <span className="wsl-state">
        <span className="hint">{t("settings.wslCommand.notRunning")}</span>
        <button onClick={p.onCheck}>{t("settings.wslCommand.check")}</button>
      </span>
    );
  if (row.kind === "busy")
    return (
      <span className="wsl-state hint">
        <Loader2 size={13} className="spin" /> {row.label}
      </span>
    );
  if (row.kind === "error")
    return (
      <span className="wsl-state">
        <span className="danger wsl-msg">{row.message}</span>
        <button onClick={p.onCheck}>{t("settings.wslCommand.retry")}</button>
      </span>
    );

  const s = row.status;
  if (s.foreign)
    return (
      <span className="wsl-state warn wsl-msg">
        <Trans i18nKey="settings.wslCommand.foreign" values={{ path: s.shim_path }} components={code} />
      </span>
    );
  if (!s.installed)
    return (
      <span className="wsl-state">
        <span className="hint">{t("settings.wslCommand.notInstalled")}</span>
        <button className="primary" onClick={p.onInstall}>
          {t("settings.wslCommand.install")}
        </button>
      </span>
    );
  if (s.on_path)
    return (
      <span className="wsl-state ok">
        <Check size={13} /> <Trans i18nKey="settings.wslCommand.ready" components={code} />
      </span>
    );
  if (s.resolves_to)
    return (
      <span className="wsl-state warn wsl-msg">
        <Trans i18nKey="settings.wslCommand.shadowed" values={{ path: s.resolves_to }} components={code} />
      </span>
    );
  return (
    <span className="wsl-state">
      <span className="warn wsl-msg">
        <Trans i18nKey="settings.wslCommand.notOnPath" components={code} />
        <span className="hint block">
          <Trans i18nKey="settings.wslCommand.addToPathHint" values={{ file: s.rc_file }} components={code} />
        </span>
      </span>
      <button className="primary" onClick={p.onAddToPath}>
        {t("settings.wslCommand.addToPath")}
      </button>
    </span>
  );
}
