// Shows credential prompts from git/ssh (passphrase, password, unknown host
// key) as a dialog. Prompts only appear when git/ssh genuinely need input:
// passwordless SSH keys, ssh-agent and credential managers never get here.
// Answers go straight back to the waiting git process and are not stored.
import { KeyRound, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptEvent } from "../../bindings/PromptEvent";
import { onAgentEvent, repoName } from "../../lib/rpc";
import { git, GIT_PROMPT } from "./api";

export function PromptDialog() {
  const [queue, setQueue] = useState<PromptEvent[]>([]);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const un = onAgentEvent((e) => {
      if (e.topic === GIT_PROMPT) setQueue((q) => [...q, e.payload as PromptEvent]);
    });
    return () => void un.then((f) => f());
  }, []);

  const current = queue[0];
  useEffect(() => {
    setValue("");
    input.current?.focus();
  }, [current?.id]);

  if (!current) return null;

  function answer(a: string | null) {
    void git.promptReply(current.repo, current.id, a).catch(() => {});
    setValue("");
    setQueue((q) => q.slice(1));
  }

  const confirm = current.kind === "confirm";
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-labelledby="prompt-title"
        onSubmit={(e) => {
          e.preventDefault();
          answer(value);
        }}
        onKeyDown={(e) => e.key === "Escape" && answer(null)}
      >
        <header>
          {confirm ? <ShieldQuestion size={18} /> : <KeyRound size={18} />}
          <h2 id="prompt-title">{confirm ? "Confirm connection" : "Git needs your credentials"}</h2>
        </header>
        <p className="hint">
          {repoName(current.repo)} · {current.op_id.split("-")[0]}
        </p>
        <pre className="prompt-text mono">{current.prompt.trim()}</pre>
        {confirm ? (
          <>
            <p className="hint">Only accept if this fingerprint matches what your Git host publishes.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => answer("no")} autoFocus>
                Reject
              </button>
              <button type="button" className="primary" onClick={() => answer("yes")}>
                Trust and continue
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              ref={input}
              type={current.kind === "secret" ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <p className="hint">Sent only to this git process. Debutuuru never stores it.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => answer(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Continue
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
