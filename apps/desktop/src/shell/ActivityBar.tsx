import { GitFork, Palette } from "lucide-react";

/** Module switcher (VS Code-style). Future modules (terminal, forge…) get a slot here. */
export function ActivityBar({ onAppearance }: { onAppearance: () => void }) {
  return (
    <nav className="activitybar" aria-label="Modules">
      <button className="activity on" title="Git" aria-current="page">
        <GitFork size={18} />
      </button>
      <div className="spacer" />
      <button className="activity" title="Appearance" onClick={onAppearance}>
        <Palette size={18} />
      </button>
    </nav>
  );
}
