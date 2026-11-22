import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

import { statusName } from "./status";

export function ChangesPanel({ repo, status, selected, onSelect, act }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const staged = status.files.filter((f) => f.index !== " " && f.index !== "?");
  const unstaged = status.files.filter((f) => f.worktree !== " ");

  const row = (f: FileChange, isStaged: boolean) => {
    const letter = isStaged ? f.index : f.worktree;
    const [dir, name] = splitPath(f.path);
    const isSel = selected?.file.path === f.path && selected.staged === isStaged;
    return (
      <li key={(isStaged ? "s:" : "u:") + f.path} className={"item file" + (isSel ? " selected" : "")} onClick={() => onSelect({ file: f, staged: isStaged })}>
        <span className={`status s-${letter === "?" ? "q" : letter}`} title={statusName(t, letter)}>
          {letter === "?" ? "U" : letter}
        </span>
        <span className="label" title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}>
          {name}
          {dir && <span className="dir">{dir}</span>}
        </span>
        <button
          className="icon-btn hover-only"
          title={isStaged ? t("git.changes.unstage") : t("git.changes.stage")}
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
        <Header title={t("git.changes.staged")} count={staged.length} action={staged.length > 0 ? t("git.changes.unstageAll") : null} onAction={() => act(() => git.unstage(repo, { paths: staged.map((f) => f.path) }))} />
        <ul>{staged.length ? staged.map((f) => row(f, true)) : <li className="empty-line">{t("git.changes.nothingStaged")}</li>}</ul>
        <Header title={t("git.changes.changes")} count={unstaged.length} action={unstaged.length > 0 ? t("git.changes.stageAll") : null} onAction={() => act(() => git.stage(repo, { paths: unstaged.map((f) => f.path) }))} />
        <ul>{unstaged.length ? unstaged.map((f) => row(f, false)) : <li className="empty-line">{t("git.changes.clean")}</li>}</ul>
      </div>
      <div className="commit-box">
        <textarea
          placeholder={t("git.changes.messagePlaceholder")}
          value={message}
          spellCheck
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && commit()}
        />
        <button className="primary" disabled={!message.trim() || staged.length === 0} onClick={commit} title="Ctrl+Enter">
          {staged.length > 0 ? t("git.changes.commitFiles", { count: staged.length }) : t("git.changes.commit")}
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
