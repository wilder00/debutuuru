// "Open…" actions: a folder or a file with the system dialog, "Browse in
// WSL…" (Windows: the dialog started in a distro's home), and recent
// repositories. Shown as the title bar's menu and on the welcome screen.
import { Clock, File, FolderOpen, Monitor, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { repoName, wslDistro } from "../lib/rpc";
import { useDismiss } from "../lib/useDismiss";

export type OpenActions = {
  openFolder: () => void;
  openFile: () => void;
  browseWsl: (distro: string) => void;
  openRecent: (repo: string) => void;
  forgetRecent: (repo: string) => void;
  /** WSL distros offered for browsing (Windows only; empty elsewhere). */
  distros: string[];
  recents: string[];
};

/** Folder icon button in the title bar with all the open actions. */
export function OpenMenuButton({ actions }: { actions: OpenActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="open-menu" ref={ref}>
      <button className={"icon-btn" + (open ? " on" : "")} aria-expanded={open} title={t("open.menu")} onClick={() => setOpen(!open)}>
        <FolderOpen size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={run(actions.openFolder)}>
            <FolderOpen size={14} /> {t("open.folder")} <kbd>Ctrl+O</kbd>
          </button>
          <button role="menuitem" onClick={run(actions.openFile)}>
            <File size={14} /> {t("open.file")}
          </button>
          {actions.distros.map((d) => (
            <button key={d} role="menuitem" onClick={run(() => actions.browseWsl(d))}>
              <Monitor size={14} /> {t("open.browseWsl", { distro: d })}
            </button>
          ))}
          {actions.recents.length > 0 && <div className="menu-label">{t("open.recent")}</div>}
          {actions.recents.slice(0, 8).map((r) => (
            <button key={r} role="menuitem" title={r} onClick={run(() => actions.openRecent(r))}>
              <Clock size={14} /> {repoName(r)}
              <span className="menu-aside">{wslDistro(r) ? `WSL · ${wslDistro(r)}` : r}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Welcome screen: the same actions as buttons, and the recent list. */
export function OpenPanel({ actions }: { actions: OpenActions }) {
  const { t } = useTranslation();
  return (
    <div className="open-panel">
      <div className="open-buttons">
        <button className="primary" onClick={actions.openFolder}>
          <FolderOpen size={14} /> {t("open.folder")}
        </button>
        <button onClick={actions.openFile}>
          <File size={14} /> {t("open.file")}
        </button>
        {actions.distros.map((d) => (
          <button key={d} onClick={() => actions.browseWsl(d)}>
            <Monitor size={14} /> {t("open.browseWsl", { distro: d })}
          </button>
        ))}
      </div>
      {actions.recents.length > 0 && (
        <div className="recent-list">
          <div className="menu-label">{t("open.recent")}</div>
          <ul>
            {actions.recents.slice(0, 10).map((r) => (
              <li key={r} className="item recent-item" title={r} onClick={() => actions.openRecent(r)}>
                <Clock size={13} />
                <span className="label">{repoName(r)}</span>
                <span className="aside">{wslDistro(r) ? `WSL · ${wslDistro(r)}` : r}</span>
                <button
                  className="icon-btn hover-only"
                  title={t("open.forget")}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.forgetRecent(r);
                  }}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
