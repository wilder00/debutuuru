// Single bridge to the Rust side. Every module calls `rpc(repo, "ns.method", params)`;
// the desktop shell routes it to the right agent (local or, later, WSL) and
// injects `repo`, so params here never include it.
import { invoke } from "@tauri-apps/api/core";
import type { ErrorCode } from "../bindings/ErrorCode";
import type { Hello } from "../bindings/Hello";
import type { RpcError } from "../bindings/RpcError";

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

export async function rpc<T>(repo: string, method: string, params: object = {}): Promise<T> {
  try {
    return await invoke<T>("rpc", { repo, method, params });
  } catch (e) {
    if (isRpcError(e)) throw new AgentError(e.code, e.message);
    throw new AgentError("transport", String(e));
  }
}

export const hello = () => invoke<Hello>("hello");
export const initialPath = () => invoke<string | null>("initial_path");

/** Params as sent from the UI: everything except `repo`. */
export type Params<T> = Omit<T, "repo">;
