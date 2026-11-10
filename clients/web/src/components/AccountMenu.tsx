import { useCallback, useState } from "react";

import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { CloudPlan } from "../protocol/rpcResults";
import { AccountChip } from "./AccountChip";

/**
 * The account chip and its menu: who is signed in, and Log out.
 *
 * The display name lives on the igni server, so it is fetched each time
 * the menu opens (the backend proxies ``/portal/me``). Until it arrives
 * the chip says the address, which is on disk and correct; the org is
 * the last resort, because it is not a person at all.
 */
export function AccountMenu({
  status,
  client,
  onLogIn,
  onLogOut,
}: {
  status: StatusUpdate | null;
  client: Pick<IgniClient, "rpc">;
  onLogIn: () => void;
  onLogOut: () => void;
}) {
  const [accountMenu, setAccountMenu] = useState(false);
  const [cloudName, setCloudName] = useState("");
  const accountName = cloudName || status?.cloud_email || status?.cloud_org || "Account";

  const toggle = useCallback(() => {
    const opening = !accountMenu;
    setAccountMenu(opening);
    if (!opening) return;
    void client
      .rpc<unknown>("get_cloud_plan")
      .then((raw) => {
        const plan = CloudPlan.parse(raw);
        if (plan.fullName) setCloudName(plan.fullName);
      })
      .catch(() => {
        /* offline: the chip keeps showing the address */
      });
  }, [accountMenu, client]);

  return (
    <>
      <AccountChip status={status} name={accountName} onLogIn={onLogIn} onOpenAccount={toggle} />
      {accountMenu && (
        <>
          <div className="account-menu-backdrop" onClick={() => setAccountMenu(false)} />
          <div className="dropdown account-menu">
            <div className="popup-item account-menu-who">
              <span className="desc">
                Signed in as <span className="account-menu-name">{accountName}</span>
                {/* The organisation decides the seat and the models, so it
                    is worth saying — but it is not who is signed in. */}
                {status?.cloud_org ? ` · ${status.cloud_org}` : ""}
              </span>
            </div>
            <div
              className="popup-item"
              onClick={() => {
                setAccountMenu(false);
                onLogOut();
              }}
            >
              <span className="cmd">Log out</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
