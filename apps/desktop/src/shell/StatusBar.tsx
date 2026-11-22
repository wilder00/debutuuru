import { ArrowDown, ArrowUp, Cpu, Download, GitBranch, Layers, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Hello } from "../bindings/Hello";
import type { Snapshot } from "../bindings/Snapshot";
import { installUpdate, useUpdateState } from "../lib/updater";

export function StatusBar({ snapshot, agent }: { snapshot: Snapshot | null; agent: Hello | null }) {
  const info = snapshot?.info;
  const st = snapshot?.status;
  const upd = useUpdateState();
  const { t } = useTranslation();
  return (
    <footer className="statusbar">
      {info && (
        <>
          <span>
            <GitBranch size={12} /> {info.head_branch ?? t("statusbar.detachedHead")}
          </span>
          {st && (st.ahead > 0 || st.behind > 0) && (
            <span title={t("statusbar.aheadBehind")}>
              <ArrowUp size={12} />
              {st.ahead} <ArrowDown size={12} />
              {st.behind}
            </span>
          )}
          <span title={info.common_dir}>
            <Layers size={12} /> {info.is_bare ? t("statusbar.bare") : info.is_linked_worktree ? t("statusbar.linkedWorktree") : t("statusbar.mainWorktree")}
          </span>
        </>
      )}
      <span className="spacer" />
      {agent && (
        <span title={t("statusbar.modules", { list: agent.modules.map((m) => `${m.name} v${m.version}`).join(", ") })}>
          <Cpu size={12} /> {t("statusbar.agent", { os: agent.os })}
          {agent.wsl_distro ? ` (${agent.wsl_distro})` : ""} · {t("statusbar.protocol", { version: agent.protocol_version })}
        </span>
      )}
      {agent && <span>v{agent.agent_version}</span>}
      {upd.kind === "available" && (
        <button className="statusbar-update" onClick={installUpdate} title={t("statusbar.updateTitle")}>
          <Download size={12} /> {t("statusbar.updateTo", { version: upd.version })}
        </button>
      )}
      {upd.kind === "installing" && (
        <span className="statusbar-update busy">
          <Loader2 size={12} className="spin" /> {t("statusbar.updatingTo", { version: upd.version })}
          {upd.percent !== null ? ` · ${upd.percent}%` : "…"}
        </span>
      )}
    </footer>
  );
}
