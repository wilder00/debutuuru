// Opening things from the system: native folder / file dialogs, "Browse in
// WSL…" (the Windows dialog started inside a distro's home), and paths
// dropped on the window. A folder opens as a repo tab; a file opens its
// repository and shows the file in Files.
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Snapshot } from "../bindings/Snapshot";
import { agentPathToRepo, resolvePath, rpc, wslDistro } from "./rpc";

export const isWindowsHost = navigator.userAgent.includes("Windows");

/** WSL distros people work in (Docker Desktop's internal ones left out). */
export const userDistros = (all: string[]) => all.filter((d) => !/^docker-desktop/i.test(d));

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const p = await openDialog({ directory: true, multiple: false, defaultPath });
  return typeof p === "string" ? p : null;
}

export async function pickFile(defaultPath?: string): Promise<string | null> {
  const p = await openDialog({ directory: false, multiple: false, defaultPath });
  return typeof p === "string" ? p : null;
}

/** The distro's home as a Windows path: `\\wsl.localhost\Ubuntu\home\me`. */
export async function wslHome(distro: string): Promise<string> {
  const home = await invoke<string>("wsl_home", { distro });
  return `\\\\wsl.localhost\\${distro}${home.replace(/\//g, "\\")}`;
}

export const pathKind = (path: string) => invoke<"dir" | "file" | null>("path_kind", { path });

/** A path as the repo's agent sees it (`/home/me/x` for WSL paths). */
function agentPath(userPath: string): string {
  if (!wslDistro(userPath)) return userPath;
  return userPath.replace(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+/i, "").replace(/\\/g, "/") || "/";
}

const parentOf = (p: string) => p.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");

/** Where a file lives: its repository's tab key and its repo-relative path. */
export async function locateFile(file: string): Promise<{ repo: string; path: string }> {
  const dir = await resolvePath(parentOf(file));
  const snap = await rpc<Snapshot>(dir, "git.snapshot");
  const repo = await resolvePath(agentPathToRepo(dir, snap.info.root));
  // Compare with `/` separators; Windows paths ignore case.
  const norm = (p: string) => {
    const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return wslDistro(file) ? s : s.toLowerCase();
  };
  const root = norm(snap.info.root);
  const abs = agentPath(file).replace(/\\/g, "/");
  if (!norm(abs).startsWith(root + "/")) throw new Error(`${file} is not inside ${snap.info.root}`);
  return { repo, path: abs.slice(root.length + 1) };
}
