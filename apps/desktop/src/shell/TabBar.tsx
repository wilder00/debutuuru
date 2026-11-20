import { X } from "lucide-react";
import { repoName, wslDistro } from "../lib/rpc";

type Props = {
  repos: string[];
  active: string | null;
  onSelect: (repo: string) => void;
  onClose: (repo: string) => void;
};

/** One tab per open repository; Windows and WSL repos can be mixed. */
export function TabBar({ repos, active, onSelect, onClose }: Props) {
  if (repos.length === 0) return null;
  return (
    <div className="tabbar" role="tablist" aria-label="Open repositories">
      {repos.map((r) => {
        const distro = wslDistro(r);
        return (
          <div
            key={r}
            role="tab"
            tabIndex={0}
            aria-selected={r === active}
            className={"tab" + (r === active ? " on" : "")}
            title={r}
            onClick={() => onSelect(r)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(r)}
            onAuxClick={(e) => e.button === 1 && onClose(r)}
          >
            <span className="tab-name">{repoName(r)}</span>
            {distro && <span className="tab-tag" title={`Inside WSL (${distro})`}>WSL</span>}
            <button
              className="icon-btn tab-close"
              title="Close tab (middle-click)"
              onClick={(e) => {
                e.stopPropagation();
                onClose(r);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
