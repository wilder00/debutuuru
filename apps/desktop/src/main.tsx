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

// Tool windows load the same page; the shell says which view to render.
const view = (window as { __DEBUTUURU_VIEW__?: string }).__DEBUTUURU_VIEW__;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>{view === "logs" ? <LogsWindow /> : view === "dictionary" ? <DictionaryWindow /> : <App />}</SettingsProvider>
  </StrictMode>,
);
