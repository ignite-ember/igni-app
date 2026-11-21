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
 *
 * ``&part=`` draws one piece alone, on a page of its own, for a visual
 * baseline each (design §12.1, §15.7): the switch in the account menu,
 * the chip's cloud states, each banner, and an extension page framed on
 * the cloud side. See ``PARTS``.
 */

import { useMemo, type ReactNode } from "react";

import { BackendStateContext } from "../cloud/backendContext";
import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { useBackendState } from "../cloud/useBackendState";
import { AccountMenu } from "../components/AccountMenu";
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

/** Who the account menu says is signed in. The address's monogram hue
 *  (218) keeps white initials above 4.5:1: igni-sdk's `Monogram` draws
 *  `hsl(hue 42% 42%)`, and about half the hues fall below it in the light
 *  theme (an igni-sdk finding, not this sandbox's). */
const SIGNED_IN = { cloud_email: "maya@acme.example", cloud_connected: true, cloud_org: "Acme" };
/** The menu asks for the person's name as it opens; offline here, so it
 *  keeps the address, the same on every run. */
const NO_SERVER = { rpc: () => Promise.reject(new Error("offline")) };

/**
 * The account menu as the header draws it, on the cloud side with a run
 * still going on this computer: both choices, Cloud chosen, and the badge
 * that switches back. Opened by its chip (the screen clicks it).
 */
function SwitchInMenu() {
  const backend = snap({ side: "cloud", state: "cloud_ready", local_activity: { runs: 1, approvals: 1 } });
  return (
    <div className="statusline" style={{ position: "relative", justifyContent: "flex-end", minHeight: 320 }}>
      <AccountMenu status={SIGNED_IN as never} client={NO_SERVER as never} backend={backend} onLogIn={() => undefined} onLogOut={() => undefined} />
    </div>
  );
}

/** The chip in each of the cloud side's states. */
const CHIP_STATES: Array<[string, string, BackendSnapshot]> = [
  ["Cloud", "Connected to your cloud igni.", snap({ side: "cloud", state: "cloud_ready" })],
  ["Waking", "Your cloud igni is starting.", snap({ side: "cloud", state: "waking" })],
  ["Sign in", "Your cloud igni needs you to sign in again.", snap({ side: "cloud", state: "cloud_needs_sign_in" })],
  ["Offline", "Your cloud igni cannot be reached.", snap({ side: "cloud", state: "cloud_unreachable", reason: "network" })],
];

function Chips() {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>
      {CHIP_STATES.map(([label, meaning, s]) => (
        <li key={label} style={{ display: "grid", gridTemplateColumns: "96px 200px 1fr", alignItems: "center" }}>
          <span>{label}</span>
          <span>
            <BackendChip backend={s} />
          </span>
          <span style={{ color: "var(--fg-muted)" }}>{meaning}</span>
        </li>
      ))}
    </ul>
  );
}

/** One banner, where the chat shows it: above the composer. */
function OneBanner({ snapshots }: { snapshots: BackendSnapshot[] }) {
  return (
    <div style={{ display: "grid", gap: 4, maxWidth: 760 }}>
      {snapshots.map((s, i) => (
        <BackendBanner key={i} backend={s} actions={INERT} />
      ))}
    </div>
  );
}

/** The extension's page on the cloud side, with the chip saying where. */
function CloudExtension() {
  const backend = useBackendState();
  return (
    <section aria-label="Extension" data-testid="cloud-extension" style={{ display: "grid", gap: 8 }}>
      <BackendChip backend={backend} />
      <ExtensionPanel />
    </section>
  );
}

/** Each piece alone: its heading, a line saying what it shows, the piece. */
const PARTS: Record<string, { title: string; caption: string; body: () => ReactNode }> = {
  switch: {
    title: "The switch in the account menu",
    caption: "Cloud is chosen, and a run and an approval are still going on this computer.",
    body: () => <SwitchInMenu />,
  },
  chips: {
    title: "The backend chip",
    caption: "The chip in the status line, in each state of the cloud side.",
    body: () => <Chips />,
  },
  "banner-sign-in": {
    title: "Banner: needs sign-in",
    caption: "The cloud igni's session ended, and the person signs in again.",
    body: () => <OneBanner snapshots={[snap({ side: "cloud", state: "cloud_needs_sign_in" })]} />,
  },
  "banner-unreachable": {
    title: "Banner: unreachable",
    caption: "The cloud igni cannot be reached; the shell retries, or the person uses this computer.",
    body: () => <OneBanner snapshots={[snap({ side: "cloud", state: "cloud_unreachable", reason: "network", retry_in_ms: 4000 })]} />,
  },
  "banner-refused": {
    title: "Banner: refused",
    caption: "The gateway refused the person, and the windows went back to this computer.",
    body: () => <OneBanner snapshots={[snap({ side: "local", state: "refused", reason: "inactive" })]} />,
  },
  "banner-mode-change": {
    title: "Banner: the organisation changed the mode",
    caption: "The notices the shell shows when an administrator moves the group between sides.",
    body: () => (
      <OneBanner
        snapshots={[
          snap({ notice: { kind: "moving_to_cloud", approvals: 1 } }),
          snap({ side: "cloud", state: "cloud_ready", notice: { kind: "moved_to_cloud" } }),
          snap({ notice: { kind: "moved_to_local" } }),
        ]}
      />
    ),
  },
  extension: {
    title: "An extension page in the cloud",
    caption: "Framed from the shell's own origin for the extension, never the address inside the VM.",
    body: () => <CloudExtension />,
  },
};

function Part({ name }: { name: string }) {
  const part = PARTS[name];
  return (
    <main className="cloud-demo" style={{ padding: 24, display: "grid", gap: 16, maxWidth: 900 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-xl)" }}>{part ? part.title : `No part called "${name}"`}</h1>
      {part && <p style={{ margin: 0, color: "var(--fg-muted)" }}>{part.caption}</p>}
      {part && <div data-testid="cloud-part">{part.body()}</div>}
    </main>
  );
}

export function CloudSwitchDemo() {
  const part = new URLSearchParams(window.location.search).get("part");
  return part === null ? <Gallery /> : <Part name={part} />;
}

function Gallery() {
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
