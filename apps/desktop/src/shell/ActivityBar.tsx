import { GitFork, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Module switcher (VS Code-style). Future modules (terminal, forge…) get a slot here. */
export function ActivityBar({ onAppearance }: { onAppearance: () => void }) {
  const { t } = useTranslation();
  return (
    <nav className="activitybar" aria-label={t("activity.label")}>
      <button className="activity on" title={t("activity.git")} aria-current="page">
        <GitFork size={18} />
      </button>
      <div className="spacer" />
      <button className="activity" title={t("activity.settings")} onClick={onAppearance}>
        <Settings size={18} />
      </button>
    </nav>
  );
}
