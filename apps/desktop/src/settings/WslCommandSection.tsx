// Settings › WSL command: makes `debutuuru .` work inside each WSL distro
// without having to open a WSL repo from the app first.
import { useEffect, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import type { WslCommandStatus } from "../bindings/WslCommandStatus";
import { wslAddToPath, wslCommandStatus, wslDistros, wslInstallCommand, wslRunning } from "../lib/rpc";

type Row =
  | { kind: "idle" } // distro not running: checked only on request (it would boot it)
  | { kind: "busy"; label: string }
  | { kind: "error"; message: string }
  | { kind: "status"; status: WslCommandStatus };

export function WslCommandSection({ Section }: { Section: (p: { title: string; children: ReactNode }) => ReactNode }) {
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
          if (running.includes(d)) run(d, "Checking…", wslCommandStatus);
          else set(d, { kind: "idle" });
        }
      })
      .catch(() => setDistros([]));
  }, []);

  if (!navigator.userAgent.includes("Windows") || !distros?.length) return null;
  return (
    <Section title="WSL command">
      <p className="hint">
        Lets you run <code className="mono">debutuuru .</code> from a WSL terminal to open that folder here. It adds <code className="mono">~/.local/bin/debutuuru</code>, a small
        script that only calls this app.
      </p>
      <ul className="wsl-rows">
        {distros.map((d) => (
          <li key={d} className="wsl-row">
            <span className="wsl-name">{d}</span>
            <DistroState
              row={rows[d] ?? { kind: "idle" }}
              onCheck={() => run(d, "Checking…", wslCommandStatus)}
              onInstall={() => run(d, "Installing…", wslInstallCommand)}
              onAddToPath={() => run(d, "Updating…", wslAddToPath)}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DistroState(p: { row: Row; onCheck: () => void; onInstall: () => void; onAddToPath: () => void }) {
  const { row } = p;
  if (row.kind === "idle")
    return (
      <span className="wsl-state">
        <span className="hint">Not running</span>
        <button onClick={p.onCheck}>Check</button>
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
        <button onClick={p.onCheck}>Retry</button>
      </span>
    );

  const s = row.status;
  if (s.foreign)
    return (
      <span className="wsl-state warn wsl-msg">
        <code className="mono">{s.shim_path}</code> already exists and wasn't written by Debutuuru, so it's left as is.
      </span>
    );
  if (!s.installed)
    return (
      <span className="wsl-state">
        <span className="hint">Not installed</span>
        <button className="primary" onClick={p.onInstall}>
          Install
        </button>
      </span>
    );
  if (s.on_path)
    return (
      <span className="wsl-state ok">
        <Check size={13} /> Ready. Open a new terminal and run <code className="mono">debutuuru .</code>
      </span>
    );
  if (s.resolves_to)
    return (
      <span className="wsl-state warn wsl-msg">
        Installed, but <code className="mono">debutuuru</code> runs <code className="mono">{s.resolves_to}</code> first in your PATH.
      </span>
    );
  return (
    <span className="wsl-state">
      <span className="warn wsl-msg">
        Installed, but <code className="mono">~/.local/bin</code> isn't in your PATH.
        <span className="hint block">
          “Add to PATH” appends one line to <code className="mono">{s.rc_file}</code>.
        </span>
      </span>
      <button className="primary" onClick={p.onAddToPath}>
        Add to PATH
      </button>
    </span>
  );
}
