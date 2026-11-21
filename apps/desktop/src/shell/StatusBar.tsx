import { ArrowDown, ArrowUp, Cpu, Download, GitBranch, Layers, Loader2 } from "lucide-react";
import type { Hello } from "../bindings/Hello";
import type { Snapshot } from "../bindings/Snapshot";
import { installUpdate, useUpdateState } from "../lib/updater";

export function StatusBar({ snapshot, agent }: { snapshot: Snapshot | null; agent: Hello | null }) {
  const info = snapshot?.info;
  const st = snapshot?.status;
  const upd = useUpdateState();
  return (
    <footer className="statusbar">
      {info && (
        <>
          <span>
            <GitBranch size={12} /> {info.head_branch ?? "detached HEAD"}
          </span>
          {st && (st.ahead > 0 || st.behind > 0) && (
            <span title="Ahead / behind upstream">
              <ArrowUp size={12} />
              {st.ahead} <ArrowDown size={12} />
              {st.behind}
            </span>
          )}
          <span title={info.common_dir}>
            <Layers size={12} /> {info.is_bare ? "bare repository" : info.is_linked_worktree ? "linked worktree" : "main worktree"}
          </span>
        </>
      )}
      <span className="spacer" />
      {agent && (
        <span title={`Modules: ${agent.modules.map((m) => `${m.name} v${m.version}`).join(", ")}`}>
          <Cpu size={12} /> agent {agent.os}
          {agent.wsl_distro ? ` (${agent.wsl_distro})` : ""} · protocol {agent.protocol_version}
        </span>
      )}
      {agent && <span>v{agent.agent_version}</span>}
      {upd.kind === "available" && (
        <button className="statusbar-update" onClick={installUpdate} title="Download, install and restart Debutuuru">
          <Download size={12} /> Update to v{upd.version}
        </button>
      )}
      {upd.kind === "installing" && (
        <span className="statusbar-update busy">
          <Loader2 size={12} className="spin" /> Updating to v{upd.version}
          {upd.percent !== null ? ` · ${upd.percent}%` : "…"}
        </span>
      )}
    </footer>
  );
}
