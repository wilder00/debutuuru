import { ChevronDown, ChevronRight, Cloud, FolderGit2, GitBranch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bindings/Snapshot";

type Props = {
  snapshot: Snapshot;
  onCheckout: (branch: string) => void;
  onOpenWorktree: (path: string) => void;
};

export function Sidebar({ snapshot, onCheckout, onOpenWorktree }: Props) {
  const { t } = useTranslation();
  const local = snapshot.branches.filter((b) => !b.is_remote);
  const remote = snapshot.branches.filter((b) => b.is_remote);
  const root = snapshot.info.root;

  return (
    <aside className="sidebar panel">
      <Group title={t("git.sidebar.branches")} count={local.length} icon={<GitBranch size={13} />}>
        {local.map((b) => (
          <li
            key={b.name}
            className={"item" + (b.is_head ? " current" : "")}
            title={`${b.subject}\n${t("git.sidebar.checkoutHint")}`}
            onDoubleClick={() => !b.is_head && onCheckout(b.name)}
          >
            <span className="dot" aria-hidden />
            <span className="label">{b.name}</span>
            {b.upstream && <span className="aside">{b.upstream}</span>}
          </li>
        ))}
      </Group>
      <Group title={t("git.sidebar.remotes")} count={snapshot.remotes.length} icon={<Cloud size={13} />}>
        {snapshot.remotes.length === 0 && <li className="empty-line">{t("git.sidebar.noRemotes")}</li>}
        {snapshot.remotes.map((r) => (
          <li key={r.name} className="item" title={`fetch: ${r.fetch_url}\npush:  ${r.push_url}`}>
            <span className="label">{r.name}</span>
            <span className={`transport t-${r.transport}`}>{r.transport}</span>
          </li>
        ))}
        {remote.map((b) => (
          <li key={b.name} className="item sub" title={b.subject}>
            <span className="label">{b.name}</span>
          </li>
        ))}
      </Group>
      <Group title={t("git.sidebar.worktrees")} count={snapshot.worktrees.length} icon={<FolderGit2 size={13} />}>
        {snapshot.worktrees.map((w) => {
          const current = w.path === root;
          return (
            <li
              key={w.path}
              className={"item" + (current ? " current" : "")}
              title={`${w.path}${current ? "" : `\n${t("git.sidebar.openHint")}`}`}
              onClick={() => !current && onOpenWorktree(w.path)}
            >
              <span className="label">{w.path.split("/").filter(Boolean).pop() ?? w.path}</span>
              <span className="aside">{w.branch ?? (w.bare ? t("git.sidebar.bare") : t("common.detached"))}</span>
            </li>
          );
        })}
      </Group>
    </aside>
  );
}

function Group(p: { title: string; count: number; icon: ReactNode; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(p.initiallyOpen ?? true);
  return (
    <section className="group">
      <button className="group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {p.icon}
        <span>{p.title}</span>
        <span className="count">{p.count}</span>
      </button>
      {open && <ul>{p.children}</ul>}
    </section>
  );
}
