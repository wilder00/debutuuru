import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettings } from "./SettingsProvider";

/** Warp-style wallpaper behind the whole app: image → blur → dim layer. */
export function BackgroundLayer() {
  const { appearance, backgroundPath } = useSettings();
  const bg = appearance.background;
  if (!bg || !backgroundPath) return null;
  return (
    <div className="bg-layer" aria-hidden>
      <div
        className="bg-image"
        style={{
          backgroundImage: `url("${convertFileSrc(backgroundPath)}")`,
          opacity: bg.opacity / 100,
          filter: bg.blur ? `blur(${bg.blur}px)` : undefined,
          // Blur samples beyond the edges; scale hides the soft border.
          transform: bg.blur ? `scale(${1 + bg.blur / 200})` : undefined,
        }}
      />
      <div className="bg-dim" style={{ opacity: bg.dim / 100 }} />
    </div>
  );
}
