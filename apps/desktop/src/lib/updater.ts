// App updates: one shared state for the status bar and Settings. Checking is
// cheap (a small JSON from the GitHub release); installing downloads the
// signed installer, verifies it against the public key built into the app,
// and runs it. On Windows the installer closes the app and starts it again.
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; checkedAt: number }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "installing"; version: string; percent: number | null }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Looks for a newer version. `quiet`: failures (offline…) don't show up as errors. */
export async function checkForUpdate(quiet = false): Promise<void> {
  if (state.kind === "checking" || state.kind === "installing") return;
  const before = state;
  set({ kind: "checking" });
  try {
    const update = await check({ timeout: 15000 });
    pending = update;
    set(update ? { kind: "available", version: update.version, notes: update.body ?? null } : { kind: "latest", checkedAt: Date.now() });
  } catch (e) {
    set(quiet ? before : { kind: "error", message: String(e) });
  }
}

/** Downloads, verifies and installs the update found by `checkForUpdate`. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update || state.kind === "installing") return;
  let total = 0;
  let done = 0;
  set({ kind: "installing", version: update.version, percent: null });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        done += ev.data.chunkLength;
        if (total > 0) set({ kind: "installing", version: update.version, percent: Math.min(100, Math.round((done / total) * 100)) });
      }
    });
    // Windows never gets here: the installer already closed the app.
    await relaunch();
  } catch (e) {
    set({ kind: "error", message: String(e) });
  }
}
