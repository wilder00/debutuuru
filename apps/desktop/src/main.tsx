import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
// Display font of the Circuit style (logo and headings only).
import "@fontsource-variable/exo-2/wght-italic.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DictionaryWindow } from "./shell/DictionaryWindow";
import { LogsWindow } from "./shell/LogsWindow";
import "./i18n";
import { SettingsProvider } from "./settings/SettingsProvider";
import "./styles.css";

// Decorative animations (Gamer/Circuit bars) pause while the window isn't
// focused or is minimized: nobody is looking, and they'd keep the GPU busy.
const syncActive = () => {
  document.documentElement.dataset.active = String(document.hasFocus() && document.visibilityState === "visible");
};
syncActive();
window.addEventListener("focus", syncActive);
window.addEventListener("blur", syncActive);
document.addEventListener("visibilitychange", syncActive);

// Circuit's light sweep runs once every few seconds instead of nonstop: a
// running animation makes the webview draw ~60 frames a second (about a
// third of a CPU core), a paused one draws none.
const SWEEP_EVERY = 7000;
const SWEEP_FOR = 1700;
window.setInterval(() => {
  const root = document.documentElement.dataset;
  if (root.style !== "circuit" || root.rgb !== "on" || root.active !== "true") return;
  root.sweep = "on";
  window.setTimeout(() => delete root.sweep, SWEEP_FOR);
}, SWEEP_EVERY);

// Tool windows load the same page; the shell says which view to render.
const view = (window as { __DEBUTUURU_VIEW__?: string }).__DEBUTUURU_VIEW__;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>{view === "logs" ? <LogsWindow /> : view === "dictionary" ? <DictionaryWindow /> : <App />}</SettingsProvider>
  </StrictMode>,
);
