import { useCallback, useEffect, useRef, useState } from "react";

import type { BackendSnapshot } from "../cloud/backendState";
import { host } from "../lib/host";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { CloudPlan } from "../protocol/rpcResults";
import { AccountChip } from "./AccountChip";
import { BackendSwitch } from "./BackendSwitch";

/**
 * The account chip and its menu: who is signed in, and Log out.
 *
 * The display name lives on the igni server, so it is fetched each time
 * the menu opens (the backend proxies ``/portal/me``). Until it arrives
 * the chip says the address, which is on disk and correct; the org is
 * the last resort, because it is not a person at all.
 *
 * The desktop's *This computer · Cloud* switch sits at the top, when the
 * shell offers it. On the cloud side the window's socket is the VM's, so
 * the account's own calls go to this computer's backend through the
 * shell (`account_rpc`): the name, and Log out, which signs the desktop
 * out and so ends the cloud connection too.
 */
export function AccountMenu({
  status,
  client,
  backend = null,
  onLogIn,
  onLogOut,
}: {
  status: StatusUpdate | null;
  client: Pick<IgniClient, "rpc">;
  backend?: BackendSnapshot | null;
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
    const ask = (host.onCloud && host.accountRpc("get_cloud_plan")) || client.rpc<unknown>("get_cloud_plan");
    void ask
      .then((raw) => {
        const plan = CloudPlan.parse(raw);
        if (plan.fullName) setCloudName(plan.fullName);
      })
      .catch(() => {
        /* offline: the chip keeps showing the address */
      });
  }, [accountMenu, client]);

  // Escape dismisses the menu, like the backdrop click, and puts focus
  // back on the chip that opened it (R683).
  const chipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAccountMenu(false);
      chipRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [accountMenu]);

  return (
    <>
      <AccountChip
        status={status}
        name={accountName}
        onLogIn={onLogIn}
        onOpenAccount={toggle}
        buttonRef={chipRef}
      />
      {accountMenu && (
        <>
          <div className="account-menu-backdrop" onClick={() => setAccountMenu(false)} />
          <div className="dropdown account-menu">
            {backend && <BackendSwitch backend={backend} />}
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
