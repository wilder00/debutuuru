import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { FileChange } from "../../bindings/FileChange";
import type { Status } from "../../bindings/Status";
import { splitPath } from "../../lib/format";
import { git } from "./api";

export type FileSelection = { file: FileChange; staged: boolean };

type Props = {
  repo: string;
  status: Status;
  selected: FileSelection | null;
  onSelect: (s: FileSelection) => void;
  /** Runs an action, shows its error if any, then reloads the repo. */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
};

const STATUS_NAME: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "?": "untracked", U: "conflict" };

export function ChangesPanel({ repo, status, selected, onSelect, act }: Props) {
  const [message, setMessage] = useState("");
  const staged = status.files.filter((f) => f.index !== " " && f.index !== "?");
  const unstaged = status.files.filter((f) => f.worktree !== " ");

  const row = (f: FileChange, isStaged: boolean) => {
    const letter = isStaged ? f.index : f.worktree;
    const [dir, name] = splitPath(f.path);
    const isSel = selected?.file.path === f.path && selected.staged === isStaged;
    return (
      <li key={(isStaged ? "s:" : "u:") + f.path} className={"item file" + (isSel ? " selected" : "")} onClick={() => onSelect({ file: f, staged: isStaged })}>
        <span className={`status s-${letter === "?" ? "q" : letter}`} title={STATUS_NAME[letter] ?? letter}>
          {letter === "?" ? "U" : letter}
        </span>
        <span className="label" title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}>
          {name}
          {dir && <span className="dir">{dir}</span>}
        </span>
        <button
          className="icon-btn hover-only"
          title={isStaged ? "Unstage" : "Stage"}
          onClick={(ev) => {
            ev.stopPropagation();
            act(() => (isStaged ? git.unstage : git.stage)(repo, { paths: [f.path] }));
          }}
        >
          {isStaged ? <Minus size={14} /> : <Plus size={14} />}
        </button>
      </li>
    );
  };

  async function commit() {
    if (await act(() => git.commit(repo, { message }))) setMessage("");
  }

  return (
    <section className="changes panel">
      <div className="changes-lists">
        <Header title="Staged" count={staged.length} action={staged.length > 0 ? "Unstage all" : null} onAction={() => act(() => git.unstage(repo, { paths: staged.map((f) => f.path) }))} />
        <ul>{staged.length ? staged.map((f) => row(f, true)) : <li className="empty-line">Nothing staged</li>}</ul>
        <Header title="Changes" count={unstaged.length} action={unstaged.length > 0 ? "Stage all" : null} onAction={() => act(() => git.stage(repo, { paths: unstaged.map((f) => f.path) }))} />
        <ul>{unstaged.length ? unstaged.map((f) => row(f, false)) : <li className="empty-line">Working tree clean</li>}</ul>
      </div>
      <div className="commit-box">
        <textarea
          placeholder="Commit message"
          value={message}
          spellCheck
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && commit()}
        />
        <button className="primary" disabled={!message.trim() || staged.length === 0} onClick={commit} title="Ctrl+Enter">
          Commit {staged.length > 0 ? `${staged.length} file${staged.length > 1 ? "s" : ""}` : ""}
        </button>
      </div>
    </section>
  );
}

function Header({ title, count, action, onAction }: { title: string; count: number; action: string | null; onAction: () => void }) {
  return (
    <div className="list-head">
      <span>{title}</span>
      <span className="count">{count}</span>
      <span className="spacer" />
      {action && (
        <button className="link-btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
