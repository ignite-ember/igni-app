import { useEffect, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { WirePayload } from "../../protocol/wirePayload";

/**
 * Browser-callback login. Progress streams in as push notifications:
 * `login_status` (text updates) then one `login_result`.
 */
export function LoginPanel({
  client,
  onDone,
  onCancel,
  overWall = false,
}: {
  client: IgniClient;
  onDone: (success: boolean, detail: string) => void;
  /** The person chose Cancel. Not a failure: nothing went wrong, so it
   *  must not be reported as "Login failed" in the conversation. */
  onCancel: () => void;
  /** Drawn over the sign-in wall, which sits above the ordinary overlay
   *  layer: without this the dialog (its fallback URL and its Cancel)
   *  was hidden behind the wall it was opened from. */
  overWall?: boolean;
}) {
  const [statusText, setStatusText] = useState("Starting login…");

  useEffect(() => {
    const off = client.onEvent((m) => {
      if (m.type !== "push_notification") return;
      const p = new WirePayload(m.payload);
      if (m.channel === "login_status") {
        setStatusText(p.text("text"));
      } else if (m.channel === "login_result") {
        onDone(p.flag("success"), p.text("result"));
      }
    });
    client.calls.login().catch((e) => onDone(false, String(e)));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={overWall ? "overlay overlay--over-wall" : "overlay"}>
      <div className="dialog">
        <div className="dialog-title">Sign in to your igni server</div>
        <div className="dialog-sub" style={{ whiteSpace: "pre-wrap" }}>
          {statusText}
        </div>
        <div className="dialog-actions">
          <button
            className="btn btn-danger"
            onClick={() => {
              client.cancelLogin();
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
