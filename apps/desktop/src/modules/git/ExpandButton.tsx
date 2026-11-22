import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Whether the diff / commit panel fills the whole tab, and how to switch. */
export type Expand = { expanded: boolean; toggle: () => void };

export function ExpandButton({ expand }: { expand: Expand }) {
  const { t } = useTranslation();
  const label = expand.expanded ? t("git.diff.restore") : t("git.diff.expand");
  return (
    <button className={"icon-btn" + (expand.expanded ? " on" : "")} onClick={expand.toggle} title={label} aria-label={label} aria-pressed={expand.expanded}>
      {expand.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}
