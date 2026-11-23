// Frame of a tool window (logs, dictionary): its own title bar (Windows draws
// none, like the main window), a toolbar row and the content. These windows
// are separate from the main one and never block it.
import type { ReactNode } from "react";
import { FxBar } from "./FxBar";
import { WindowControls } from "./WindowControls";

export function ToolWindow({ title, icon, toolbar, children }: { title: string; icon: ReactNode; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="app tool-window">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          {icon}
          {title}
        </div>
        <div className="titlebar-drag" data-tauri-drag-region style={{ flex: 1 }} />
        <WindowControls />
        <FxBar at="top" />
      </header>
      {toolbar && <div className="tool-toolbar">{toolbar}</div>}
      <main className="tool-body">{children}</main>
    </div>
  );
}
