import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
// Display font of the Circuit style (logo and headings only).
import "@fontsource-variable/exo-2/wght-italic.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import { SettingsProvider } from "./settings/SettingsProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
