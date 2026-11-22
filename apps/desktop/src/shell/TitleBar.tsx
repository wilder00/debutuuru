import { FolderOpen, GitBranch, PanelLeft, PanelRight, RefreshCw } from "lucide-react";
import { useSettings } from "../settings/SettingsProvider";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RepoInfo } from "../bindings/RepoInfo";
import { WindowControls } from "./WindowControls";

type Props = {
  repo: string | null;
  info: RepoInfo | null;
  onOpen: (path: string) => void;
  onRefresh: () => void;
  /** "Open…" menu (folder, file, WSL, recent). */
  openMenu?: ReactNode;
};

/** Show or hide the side panels of repository tabs (Ctrl+B, Ctrl+Alt+B). */
function PanelToggles() {
  const { t } = useTranslation();
  const { layout, updateLayout } = useSettings();
  return (
    <>
      <button
        className={"icon-btn" + (layout.sidebar ? " on" : "")}
        aria-pressed={layout.sidebar}
        title={`${layout.sidebar ? t("titlebar.hideSidebar") : t("titlebar.showSidebar")} (Ctrl+B)`}
        onClick={() => updateLayout({ sidebar: !layout.sidebar })}
      >
        <PanelLeft size={15} />
      </button>
      <button
        className={"icon-btn" + (layout.changes ? " on" : "")}
        aria-pressed={layout.changes}
        title={`${layout.changes ? t("titlebar.hideChanges") : t("titlebar.showChanges")} (Ctrl+Alt+B)`}
        onClick={() => updateLayout({ changes: !layout.changes })}
      >
        <PanelRight size={15} />
      </button>
    </>
  );
}

export function TitleBar({ repo, info, onOpen, onRefresh, openMenu }: Props) {
  const { t } = useTranslation();
  // Shows the active tab's path in the form the user can type back
  // (for WSL repos the UNC path, not the Linux path the agent reports).
  const [input, setInput] = useState(repo ?? "");
  useEffect(() => setInput(repo ?? ""), [repo]);

  return (
    // On Windows the native title bar is off: this bar moves the window
    // (drag the empty parts or the logo; double-click maximizes).
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" title="Debutuuru" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden data-tauri-drag-region />
        Debutuuru
      </div>
      <form
        className="repo-picker"
        onSubmit={(e) => {
          e.preventDefault();
          onOpen(input);
        }}
      >
        <FolderOpen size={14} aria-hidden />
        <input
          value={input}
          spellCheck={false}
          placeholder={t("titlebar.pathPlaceholder")}
          aria-label={t("titlebar.pathLabel")}
          onChange={(e) => setInput(e.target.value)}
        />
        {info && (
          <span className="chip" title={info.is_linked_worktree ? t("titlebar.linkedWorktree") : t("titlebar.currentBranch")}>
            <GitBranch size={12} />
            {info.head_branch ?? t("common.detached")}
          </span>
        )}
      </form>
      <div className="titlebar-drag" data-tauri-drag-region />
      {openMenu}
      {repo && <PanelToggles />}
      <button className="icon-btn" onClick={onRefresh} disabled={!repo} title={t("titlebar.refresh")}>
        <RefreshCw size={15} />
      </button>
      <WindowControls />
    </header>
  );
}
