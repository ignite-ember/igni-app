import { useCallback, useEffect, useRef, useState } from "react";

import { authPhaseOf, type AuthPhase } from "../chat/useShellStatus";
import { nameFromEmail } from "../lib/displayName";
import { host } from "../lib/host";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { CloudPlan } from "../protocol/rpcResults";
import { AccountChip } from "./AccountChip";
import type { GroupBadge } from "./GroupIndicator";
import { FlameIcon } from "./Icons";
import { BackendVersionChip } from "./StatusBits";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The account chip and its menu: who is signed in, and Log out.
 *
 * The display name lives on the igni server. The chip sits at the foot
 * of the sidebar for the whole session, so the name is fetched as soon
 * as somebody is signed in (the backend proxies ``/portal/me``) rather
 * than waiting for the menu to open — the row reads name over address
 * from the start. Until it arrives the chip says the address, which is
 * on disk and correct; the org is the last resort, because it is not a
 * person at all.
 *
 * On the cloud side the window's socket is the VM's, so the account's own
 * calls go to this computer's backend through the shell (`account_rpc`):
 * the name, and Log out, which signs the desktop out and so ends the
 * cloud connection too. The *This computer · Cloud* switch lives under
 * the composer now, not here.
 */
export function AccountMenu({
  status,
  client,
  auth = authPhaseOf(status),
  group,
  onLogIn,
  onLogOut,
}: {
  status: StatusUpdate | null;
  client: Pick<IgniClient, "rpc">;
  /** Whether anybody is known to be signed in; ``unknown`` on the cloud
   *  side until this computer has said who. */
  auth?: AuthPhase;
  /** The group this person's agents come from — shown as the chip's
   *  second line when they are in one. */
  group?: GroupBadge;
  onLogIn: () => void;
  onLogOut: () => void;
}) {
  const [accountMenu, setAccountMenu] = useState(false);
  const [cloudName, setCloudName] = useState("");
  // The server's own name wins; until it arrives, a name read off the
  // address beats showing the raw address as if it were the name. The
  // address itself stays in the menu below.
  const accountName =
    cloudName || nameFromEmail(status?.cloud_email) || status?.cloud_org || "Account";
  // Second line: the group this person's agents come from — the group
  // name when in one, "No group" when not — so the account and the
  // group read as one control, not two stacked rows. The address keeps
  // to the menu. When no group is known at all (the chip used without
  // one), the address stands in.
  const subtitle = group
    ? group.label === "none"
      ? "No group"
      : group.label
    : status?.cloud_email || "";

  const loadName = useCallback(() => {
    const ask = (host.onCloud && host.accountRpc("get_cloud_plan")) || client.rpc<unknown>("get_cloud_plan");
    void ask
      .then((raw) => {
        const plan = CloudPlan.parse(raw);
        if (plan.fullName) setCloudName(plan.fullName);
      })
      .catch(() => {
        /* offline: the chip keeps showing the address */
      });
  }, [client]);

  // Fetch the name whenever somebody is signed in, so the footer row
  // shows it without the person having to open the menu first.
  useEffect(() => {
    if (status?.cloud_email) loadName();
  }, [status?.cloud_email, loadName]);

  const toggle = useCallback(() => setAccountMenu((open) => !open), []);

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
        subtitle={subtitle}
        onLogIn={onLogIn}
        onOpenAccount={toggle}
        buttonRef={chipRef}
        pending={auth === "unknown"}
      />
      {accountMenu && (
        <>
          <div className="account-menu-backdrop" onClick={() => setAccountMenu(false)} />
          <div className="dropdown account-menu">
            {/* The igni flame, wordmark and build, at the top of the menu
                — the app's identity header. */}
            <div className="account-menu-brand">
              <FlameIcon size={15} />
              <span>igni</span>
              <BackendVersionChip />
            </div>
            <div className="account-menu-sep" />
            <div className="popup-item account-menu-who">
              <span className="desc">
                Signed in as <span className="account-menu-name">{accountName}</span>
                {/* The organisation decides the seat and the models, so it
                    is worth saying — but it is not who is signed in. */}
                {status?.cloud_org ? ` · ${status.cloud_org}` : ""}
              </span>
              {/* The address, kept here in full since the chip's second
                  line gives way to the group when there is one. */}
              {status?.cloud_email && status.cloud_email !== accountName && (
                <span className="desc account-menu-email">{status.cloud_email}</span>
              )}
            </div>
            <div className="account-menu-sep" />
            {/* Appearance — the theme control, moved here from the top of
                the sidebar. The toggle cycles auto → light → dark. */}
            <div className="popup-item account-menu-theme">
              <span className="cmd">Appearance</span>
              <ThemeToggle />
            </div>
            <div className="account-menu-sep" />
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
