// Accent bar of the Gamer and Circuit styles (title bar, status bar, active
// tab), with its animation: a light sweeping across (Circuit) or the RGB
// colors flowing (Gamer). The moving part only changes `transform`, which
// the GPU composites without repainting; animating the background instead
// repainted every frame and kept a CPU core busy while the app sat idle.
// Hidden in the Standard style (CSS).
export function FxBar({ at }: { at: "top" | "bottom" | "tab" }) {
  return (
    <span className={"fx-bar fx-" + at} aria-hidden>
      <span className="fx-move" />
    </span>
  );
}
