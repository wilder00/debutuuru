import { ChevronDown, ChevronRight, Cloud, FolderGit2, GitBranch } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Snapshot } from "../../bindings/Snapshot";

type Props = {
  snapshot: Snapshot;
  onCheckout: (branch: string) => void;
  onOpenWorktree: (path: string) => void;
};

export function Sidebar({ snapshot, onCheckout, onOpenWorktree }: Props) {
  const local = snapshot.branches.filter((b) => !b.is_remote);
  const remote = snapshot.branches.filter((b) => b.is_remote);
  const root = snapshot.info.root;

  return (
    <aside className="sidebar panel">
      <Group title="Branches" count={local.length} icon={<GitBranch size={13} />}>
        {local.map((b) => (
          <li
            key={b.name}
            className={"item" + (b.is_head ? " current" : "")}
            title={`${b.subject}\nDouble-click to check out`}
            onDoubleClick={() => !b.is_head && onCheckout(b.name)}
          >
            <span className="dot" aria-hidden />
            <span className="label">{b.name}</span>
            {b.upstream && <span className="aside">{b.upstream}</span>}
          </li>
        ))}
      </Group>
      {remote.length > 0 && (
        <Group title="Remotes" count={remote.length} icon={<Cloud size={13} />} initiallyOpen={false}>
          {remote.map((b) => (
            <li key={b.name} className="item" title={b.subject}>
              <span className="label">{b.name}</span>
            </li>
          ))}
        </Group>
      )}
      <Group title="Worktrees" count={snapshot.worktrees.length} icon={<FolderGit2 size={13} />}>
        {snapshot.worktrees.map((w) => {
          const current = w.path === root;
          return (
            <li
              key={w.path}
              className={"item" + (current ? " current" : "")}
              title={`${w.path}${current ? "" : "\nClick to open"}`}
              onClick={() => !current && onOpenWorktree(w.path)}
            >
              <span className="label">{w.path.split("/").filter(Boolean).pop() ?? w.path}</span>
              <span className="aside">{w.branch ?? (w.bare ? "bare" : "detached")}</span>
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
