// One terminal: xterm.js connected to a program in the agent. Sized to its
// container (fit addon), drawn with WebGL when available, colored from the
// theme tokens. Keys: Ctrl+C copies when text is selected (else it's ^C for the
// program), Ctrl+V and Ctrl+Shift+V paste, Ctrl+Shift+C copies; the app's own
// shortcuts (Ctrl+Shift+P, Ctrl+`, Ctrl+,) stay with the app, the rest go to
// the program (Ctrl+P, Ctrl+W… are shell keys).
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TerminalProfile } from "../../bindings/TerminalProfile";
import { useSettings } from "../../settings/SettingsProvider";
import { listenTerminals, subscribe, term } from "./api";
import { spawnParams } from "./profiles";
import { terminalFont, terminalTheme } from "./theme";

type Props = {
  profile: TerminalProfile;
  /** Repository whose folder the terminal starts in. */
  repo: string | null;
  active: boolean;
  onExit: (code: number | null) => void;
};

/** Shortcuts that belong to the app even while the terminal has focus. */
const appKey = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === "p") || e.code === "Backquote" || e.key === ",");

export function TerminalView({ profile, repo, active, onExit }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const xterm = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const { appearance } = useSettings();
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const el = host.current!;
    const x = new Terminal({
      fontFamily: terminalFont(),
      fontSize: appearance.font_size,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 10000,
      theme: terminalTheme(),
    });
    const f = new FitAddon();
    x.loadAddon(f);
    x.open(el);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      x.loadAddon(webgl);
    } catch {
      // No WebGL: xterm's DOM renderer still works.
    }
    f.fit();
    xterm.current = x;
    fit.current = f;

    let id: string | null = null;
    let unsub = () => {};
    let disposed = false;
    const copy = () => {
      if (x.hasSelection()) void navigator.clipboard.writeText(x.getSelection());
    };
    x.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (appKey(e)) return false;
      if (mod && key === "c" && (e.shiftKey || x.hasSelection())) {
        copy();
        x.clearSelection();
        e.preventDefault();
        return false;
      }
      // Let the browser paste into xterm's input (xterm turns it into input).
      if (mod && key === "v") return false;
      return true;
    });
    x.onData((data) => id && void term.write(id, data).catch(() => {}));
    x.onResize(({ cols, rows }) => id && void term.resize(id, cols, rows).catch(() => {}));

    listenTerminals();
    term
      .spawn(spawnParams(profile, repo, x.cols, x.rows))
      .then(({ id: newId }) => {
        if (disposed) return void term.kill(newId).catch(() => {});
        id = newId;
        unsub = subscribe(newId, {
          output: (data) => x.write(data),
          exit: (code) => {
            id = null;
            const msg = code === null ? tRef.current("term.exitedNoCode") : tRef.current("term.exited", { code });
            x.write(`\r\n\x1b[2m[${msg}]\x1b[0m\r\n`);
            onExitRef.current(code);
          },
        });
      })
      .catch((e) => {
        x.write(`\x1b[31m${tRef.current("term.startFailed", { name: profile.name, error: e instanceof Error ? e.message : String(e) })}\x1b[0m\r\n`);
        onExitRef.current(null);
      });

    // Refit when the panel or window changes size.
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.offsetParent !== null) f.fit();
      });
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(frame);
      unsub();
      if (id) void term.kill(id).catch(() => {});
      x.dispose();
    };
    // One program per view: profile and repo are fixed at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme, style or font size changed: recolor without restarting.
  useEffect(() => {
    const x = xterm.current;
    if (!x) return;
    x.options.theme = terminalTheme();
    x.options.fontFamily = terminalFont();
    x.options.fontSize = appearance.font_size;
    fit.current?.fit();
  }, [appearance]);

  // Shown again (tab switch, panel reopened): fit and focus.
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fit.current?.fit();
      xterm.current?.focus();
    });
  }, [active]);

  return <div className="terminal-view" ref={host} hidden={!active} />;
}
