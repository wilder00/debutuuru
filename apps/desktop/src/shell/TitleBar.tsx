import { FolderOpen, GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { RepoInfo } from "../bindings/RepoInfo";

type Props = {
  repo: string | null;
  info: RepoInfo | null;
  onOpen: (path: string) => void;
  onRefresh: () => void;
};

export function TitleBar({ repo, info, onOpen, onRefresh }: Props) {
  // Shows the active tab's path in the form the user can type back
  // (for WSL repos the UNC path, not the Linux path the agent reports).
  const [input, setInput] = useState(repo ?? "");
  useEffect(() => setInput(repo ?? ""), [repo]);

  return (
    <header className="titlebar">
      <div className="brand" title="Debutuuru">
        <span className="brand-mark" aria-hidden />
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
          placeholder="Open a repository: C:\code\app or \\wsl.localhost\Ubuntu\home\me\app"
          aria-label="Repository path"
          onChange={(e) => setInput(e.target.value)}
        />
        {info && (
          <span className="chip" title={info.is_linked_worktree ? "Linked worktree" : "Current branch"}>
            <GitBranch size={12} />
            {info.head_branch ?? "detached"}
          </span>
        )}
      </form>
      <button className="icon-btn" onClick={onRefresh} disabled={!repo} title="Refresh (F5)">
        <RefreshCw size={15} />
      </button>
    </header>
  );
}
