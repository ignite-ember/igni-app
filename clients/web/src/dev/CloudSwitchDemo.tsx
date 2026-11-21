/**
 * UI sandbox for the desktop's cloud switch (``?demo=cloud``, see
 * ``main.tsx``): the *This computer · Cloud* control, the backend chip
 * and every banner of design §4.2 and §8, drawn from canned shell
 * snapshots so the visual baseline is fixed.
 *
 * The "Live" panel at the top is the test hook: it renders whatever the
 * shell would push (``igni-host`` / ``igni:backend-state``), through the
 * same hook the app uses, so the browser suite can walk the states the
 * way the shell does.
 *
 * The "Extension" panel lists one extension through ``useExtensions``
 * from a stand-in backend that reports a VM-internal origin, so the
 * suite can see the page framed from the shell's origin instead
 * (``cloud_page_origin``) and the extension's indicator drawn (§15).
 */

import { useMemo } from "react";

import { BackendStateContext } from "../cloud/backendContext";
import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { useBackendState } from "../cloud/useBackendState";
import { BackendBanner, type BackendActions } from "../components/BackendBanner";
import { BackendChip } from "../components/BackendChip";
import { BackendSwitch } from "../components/BackendSwitch";
import { WakingOverlay } from "../components/WakingOverlay";
import { ExtensionIndicator } from "../extensions/ExtensionIndicator";
import { ExtensionPage, type ExtensionSummary } from "../extensions/ExtensionPage";
import { useExtensions } from "../extensions/useExtensions";

/** What the VM's igni lists: its origin is an address inside the VM. */
const VM_EXTENSION: ExtensionSummary = {
  id: "acme.reviewer",
  name: "Reviewer",
  version: "1.0.0",
  state: "READY",
  reason: "",
  origin: "http://127.0.0.1:41234",
  allow: [],
  pages: [{ kind: "acme.reviewer.page", label: "Reviews", sidebar: true, entry: "index.html" }],
  menu: [],
  indicators: [{ id: "queue", label: "Reviews", source: "queue_size", opens: "acme.reviewer.page", intervalSeconds: 0 }],
  settings: [],
  values: {},
};

/** The stand-in backend: lists the extension, answers its indicator. */
const DEMO_BACKEND = {
  rpc: async (method: string) =>
    method === "list_extensions" ? { extensions: [VM_EXTENSION] } : { label: "3 waiting", tone: "warning", detail: "" },
};
const NO_MODEL = { get: () => [], write: () => undefined };

function ExtensionPanel() {
  const backend = useBackendState();
  const { extensions } = useExtensions(DEMO_BACKEND as never, true, NO_MODEL as never);
  const extension = extensions[0];
  const onCall = useMemo(() => async () => ({ label: "3 waiting", tone: "warning", detail: "" }), []);
  if (!extension) return null;
  return (
    <BackendStateContext.Provider value={backend}>
      <div className="statusline">
        {extension.indicators.map((indicator) => (
          <ExtensionIndicator key={indicator.id} extensionId={extension.id} indicator={indicator} unread={0} onCall={onCall} onOpen={() => undefined} />
        ))}
      </div>
      <div style={{ height: 160 }}>
        <ExtensionPage extension={extension} kind="acme.reviewer.page" onCall={async () => null} />
      </div>
    </BackendStateContext.Provider>
  );
}

const snap = (o: Record<string, unknown>) => BackendSnapshot.parse(shellSnapshot(o))!;

/** The gallery's buttons do nothing: it is a picture. */
const INERT: BackendActions = {
  signIn: async () => undefined,
  retry: () => undefined,
  useThisComputer: async () => undefined,
  dismiss: () => undefined,
};

const CHIPS: Array<[string, BackendSnapshot]> = [
  ["This computer", snap({})],
  ["Cloud", snap({ side: "cloud", state: "cloud_ready" })],
  ["Waking", snap({ side: "cloud", state: "waking" })],
  ["Sign in", snap({ side: "cloud", state: "cloud_needs_sign_in" })],
  ["Offline", snap({ side: "cloud", state: "cloud_unreachable", reason: "network" })],
  ["Cloud mode", snap({ side: "cloud", state: "cloud_ready", mode: "cloud", switch_visible: false })],
  ["VM cannot reach igni server", snap({ side: "cloud", state: "cloud_ready", credential_warning: true })],
];

const BANNERS: Array<[string, BackendSnapshot]> = [
  ["Needs sign-in", snap({ side: "cloud", state: "cloud_needs_sign_in" })],
  ["Unreachable", snap({ side: "cloud", state: "cloud_unreachable", reason: "network", retry_in_ms: 4000 })],
  ["Busy", snap({ side: "cloud", state: "cloud_unreachable", reason: "busy" })],
  ["Could not start", snap({ side: "cloud", state: "cloud_unreachable", reason: "could_not_start", detail: "the VM did not answer in 20 s" })],
  ["Certificate", snap({ side: "cloud", state: "cloud_unreachable", reason: "certificate" })],
  ["Unreachable, cloud mode", snap({ side: "cloud", state: "cloud_unreachable", reason: "network", can_use_local: false, mode: "cloud" })],
  ["Refused, back here", snap({ side: "local", state: "refused", reason: "inactive" })],
  ["Moving to the cloud", snap({ notice: { kind: "moving_to_cloud", approvals: 1 } })],
  ["Moved to this computer", snap({ notice: { kind: "moved_to_local" } })],
];

export function CloudSwitchDemo() {
  const live = useBackendState();
  return (
    // A page of its own, like every other sandbox: one <main> and one
    // <h1>, so the accessibility gate measures the switch's parts rather
    // than a document with no landmark (axe landmark-one-main,
    // page-has-heading-one).
    <main className="cloud-demo" style={{ padding: 24, display: "grid", gap: 24, maxWidth: 900 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-xl)" }}>Local / Cloud switch · UI sandbox</h1>
      <section aria-label="Live" data-testid="cloud-live" style={{ position: "relative", minHeight: 120, border: "1px dashed var(--border)", borderRadius: 12, padding: 12 }}>
        <div className="statusline">
          <BackendChip backend={live} />
        </div>
        {live && (
          <div className="dropdown account-menu" style={{ position: "static", width: 280 }}>
            <BackendSwitch backend={live} />
          </div>
        )}
        <BackendBanner backend={live} />
        <WakingOverlay backend={live} />
      </section>

      {new URLSearchParams(window.location.search).has("extension") && (
        <section aria-label="Extension" data-testid="cloud-extension">
          <ExtensionPanel />
        </section>
      )}

      <section aria-label="Switch">
        <div className="dropdown account-menu" style={{ position: "static", width: 280 }}>
          <BackendSwitch backend={snap({})} />
          <BackendSwitch backend={snap({ side: "cloud", state: "cloud_ready", local_activity: { runs: 1, approvals: 0 } })} />
        </div>
      </section>

      <section aria-label="Chips" className="statusline" style={{ flexWrap: "wrap", gap: 8 }}>
        {CHIPS.map(([label, s]) => (
          <span key={label} title={label}>
            <BackendChip backend={s} />
          </span>
        ))}
      </section>

      <section aria-label="Banners" style={{ display: "grid", gap: 4 }}>
        {BANNERS.map(([label, s]) => (
          <BackendBanner key={label} backend={s} actions={INERT} />
        ))}
      </section>
    </main>
  );
}
