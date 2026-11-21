// Single bridge to the Rust side. Every module calls `rpc(repo, "ns.method", params)`;
// the desktop shell routes it to the right agent (in-process for host repos,
// inside WSL for `\\wsl.localhost\…` repos) and injects `repo`, so params here
// never include it.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "../bindings/AgentEvent";
import type { ErrorCode } from "../bindings/ErrorCode";
import type { Hello } from "../bindings/Hello";
import type { RpcError } from "../bindings/RpcError";
import type { WslCommandStatus } from "../bindings/WslCommandStatus";

export class AgentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isRpcError(e: unknown): e is RpcError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (isRpcError(e)) throw new AgentError(e.code, e.message);
    throw new AgentError("transport", String(e));
  }
}

export const rpc = <T>(repo: string, method: string, params: object = {}) => call<T>("rpc", { repo, method, params });

/** Handshake of the agent serving `repo` ("" = local agent). */
export const agentHello = (repo: string) => call<Hello>("agent_hello", { repo });
/** Canonical tab key for a typed path (absolute, or `\\wsl.localhost\…`). */
export const resolvePath = (input: string) => invoke<string>("resolve_path", { input });
export const initialPath = () => invoke<string | null>("initial_path");
export const wslDistros = () => invoke<string[]>("wsl_distros");
/** Distros running now: checking them doesn't boot anything. */
export const wslRunning = () => invoke<string[]>("wsl_running");
export const wslCommandStatus = (distro: string) => call<WslCommandStatus>("wsl_command_status", { distro });
export const wslInstallCommand = (distro: string) => call<WslCommandStatus>("wsl_install_command", { distro });
export const wslAddToPath = (distro: string) => call<WslCommandStatus>("wsl_add_to_path", { distro });

/** Emitted when a WSL agent process exits; payload `{ distro }`. */
export const AGENT_DISCONNECTED = "agent.disconnected";

export const onAgentEvent =(fn: (e: AgentEvent) => void): Promise<UnlistenFn> =>
  listen<AgentEvent>("agent-event", (e) => fn(e.payload));
/** Paths sent by `debutuuru <path>` while the app is already running. */
export const onOpenRepo = (fn: (repo: string) => void): Promise<UnlistenFn> => listen<string>("open-repo", (e) => fn(e.payload));

/** Params as sent from the UI: everything except `repo`. */
export type Params<T> = Omit<T, "repo">;

const WSL = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)/i;
/** `Ubuntu` for `\\wsl.localhost\Ubuntu\…`, else null. */
export const wslDistro = (repo: string) => WSL.exec(repo)?.[1] ?? null;

/** Converts a path reported by the repo's agent into a tab key. */
export function agentPathToRepo(repo: string, agentPath: string): string {
  const d = wslDistro(repo);
  return d ? `\\\\wsl.localhost\\${d}${agentPath.replace(/\//g, "\\")}` : agentPath;
}

/** Last path segment, for tab titles. */
export const repoName = (repo: string) => repo.split(/[\\/]/).filter(Boolean).pop() ?? repo;
