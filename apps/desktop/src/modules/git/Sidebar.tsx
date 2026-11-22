import { ChevronDown, ChevronRight, Cloud, FolderGit2, GitBranch, Plus, Tag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bindings/Snapshot";
import { fullDate, relativeTime } from "../../lib/format";

type Props = {
  snapshot: Snapshot;
  onCheckout: (branch: string) => void;
  onOpenWorktree: (path: string) => void;
  /** Tag shown in the details panel. */
  selectedTag: string | null;
  onSelectTag: (name: string) => void;
  onCreateTag: () => void;
};

/** With more tags than this, the section gets a filter box. */
const FILTER_FROM = 8;

export function Sidebar({ snapshot, onCheckout, onOpenWorktree, selectedTag, onSelectTag, onCreateTag }: Props) {
  const { t } = useTranslation();
  const local = snapshot.branches.filter((b) => !b.is_remote);
  const remote = snapshot.branches.filter((b) => b.is_remote);
  const root = snapshot.info.root;
  const [tagFilter, setTagFilter] = useState("");
  const tags = snapshot.tags.filter((g) => g.name.toLowerCase().includes(tagFilter.trim().toLowerCase()));

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
      <Group
        title={t("git.sidebar.tags")}
        count={snapshot.tags.length}
        icon={<Tag size={13} />}
        action={
          <button className="icon-btn group-action" title={t("git.tags.create")} onClick={onCreateTag}>
            <Plus size={13} />
          </button>
        }
      >
        {snapshot.tags.length > FILTER_FROM && (
          <li className="group-filter">
            <input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder={t("git.tags.filter")} aria-label={t("git.tags.filter")} spellCheck={false} />
          </li>
        )}
        {snapshot.tags.length === 0 && <li className="empty-line">{t("git.tags.none")}</li>}
        {tags.map((g) => (
          <li
            key={g.name}
            className={"item" + (g.name === selectedTag ? " selected" : "")}
            title={`${g.name} · ${g.annotated ? t("git.tags.annotated") : t("git.tags.lightweight")}\n${fullDate(g.time)}\n${g.commit_subject}`}
            onClick={() => onSelectTag(g.name)}
          >
            <span className="label">{g.name}</span>
            <span className="aside">{relativeTime(g.time)}</span>
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

function Group(p: { title: string; count: number; icon: ReactNode; initiallyOpen?: boolean; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(p.initiallyOpen ?? true);
  return (
    <section className="group">
      <div className="group-row">
        <button className="group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {p.icon}
          <span>{p.title}</span>
          <span className="count">{p.count}</span>
        </button>
        {p.action}
      </div>
      {open && <ul>{p.children}</ul>}
    </section>
  );
}
