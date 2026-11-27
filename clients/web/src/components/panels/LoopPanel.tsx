import { useCallback, useEffect, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { PageEmpty } from "../page/PageEmpty";
import { Button } from "../page/Button";

interface LoopStatus {
  active?: boolean;
  prompt?: string;
  paused?: boolean;
  iteration_index?: number;
  iterations_remaining?: number;
  /** True when the user set the cap explicitly (render N/M); false
   * means the cap is just a safety net (render N only). */
  cap_explicit?: boolean;
  /** Agent-announced total via loop_set_total — wins over the cap. */
  announced_total?: number | null;
}

export function LoopPanel({
  client,
  onResume,
  onClose,
}: {
  client: IgniClient;
  /** Called when the user presses Resume. The panel-side ``loop_resume``
   *  RPC flips the paused flag and returns the wrapped iteration
   *  prompt — actually firing the iteration is the caller's job
   *  (same trick the ``/loop resume`` slash command uses). The host
   *  passes the returned prompt straight to ``runUserMessage`` AND
   *  paints a loop iteration card. ``""`` from the RPC means the
   *  loop wasn't paused / not resumable — no-op then. */
  onResume: (prompt: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<LoopStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await client.rpc<LoopStatus>("loop_status"));
    } catch (e) {
      console.error(e);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 1_500);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (method: string) => {
    try {
      await client.rpc(method);
    } finally {
      void refresh();
    }
  };

  const resumeLoop = async () => {
    try {
      const prompt = await client.rpc<string>("loop_resume");
      if (prompt) onResume(prompt);
    } finally {
      void refresh();
    }
  };

  return (
    <Drawer title="Loop" onClose={onClose}>
      {!status?.active && (
        <PageEmpty
          title="No active loop"
          hint={
            <>
              Start one with <code>/loop &lt;prompt&gt;</code>.
            </>
          }
        />
      )}
      {status?.active && (
        <>
          <dl className="kv">
            <dt>Prompt</dt>
            <dd>{status.prompt}</dd>
            <dt>Iteration</dt>
            <dd>
              {status.iteration_index ?? 0}
              {(() => {
                const total =
                  status.announced_total ??
                  (status.cap_explicit
                    ? (status.iteration_index ?? 0) + (status.iterations_remaining ?? 0)
                    : null);
                return total ? `/${total}` : "";
              })()}
            </dd>
            <dt>State</dt>
            <dd>{status.paused ? "paused" : "running"}</dd>
          </dl>
          <div className="dialog-actions" style={{ marginTop: 16 }}>
            {status.paused ? (
              <Button size="sm" onClick={() => void resumeLoop()}>
                Resume
              </Button>
            ) : (
              <Button size="sm" onClick={() => act("loop_pause")}>
                Pause
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => act("cancel_pending_loop")}>
              Stop loop
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}
