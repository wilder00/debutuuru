// Minimize / maximize / close for Windows, where the app draws its own title
// bar (tauri.windows.conf.json turns the native one off so it matches the
// theme). Linux keeps its window manager's title bar, so nothing renders there.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isWindowsHost } from "../lib/open";

export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindowsHost) return;
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized, () => {});
    sync();
    const un = win.onResized(sync);
    return () => void un.then((f) => f());
  }, []);

  if (!isWindowsHost) return null;
  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button className="window-btn" onClick={() => void win.minimize()} title={t("window.minimize")} aria-label={t("window.minimize")}>
        <Minus size={15} />
      </button>
      <button
        className="window-btn"
        onClick={() => void win.toggleMaximize()}
        title={maximized ? t("window.restore") : t("window.maximize")}
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
      >
        {maximized ? <Copy size={12} style={{ transform: "scaleX(-1)" }} /> : <Square size={12} />}
      </button>
      <button className="window-btn close" onClick={() => void win.close()} title={t("window.close")} aria-label={t("window.close")}>
        <X size={16} />
      </button>
    </div>
  );
}
