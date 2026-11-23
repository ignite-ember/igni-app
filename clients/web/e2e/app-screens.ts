/**
 * The desktop app's main screens, as a list two specs share.
 *
 * E5. The portal got sixty-four pictures and then a baseline per page
 * (E2–E4); this is the same treatment for the app, and the same reason
 * — 727 unit tests and 48 browser tests, and not one of them had ever
 * looked at a screen.
 *
 * Every entry is driven by a `?demo=` route, so the data is fixed
 * fixtures rather than a backend: no session ids, no timestamps, no
 * model output that differs between runs. That is what makes a picture
 * comparable tomorrow.
 *
 * The team scenarios are chosen rather than enumerated. `SCENARIOS` in
 * `dev/OrchestrateDemo.tsx` has fifteen, several of which differ by one
 * event in a card — a baseline each buys little and costs a PNG each.
 * These are the surfaces a change would be felt on.
 */

export type AppScreen = {
  /** File-name stem for shots and baselines. */
  name: string
  /** Query string to open. */
  demo: string
  /**
   * Scenario title to click first, for the `team` sandbox, which mounts
   * with a nav and nothing selected.
   */
  scenario?: RegExp
  /** Extra settle time where a screen animates itself in. */
  settleMs?: number
  /**
   * Expand every collapsed tool card first.
   *
   * Tool cards mount collapsed, showing a truncated argument preview.
   * On the screens whose subject *is* what the card contains — the diff
   * table, a long thinking block — a shot of the collapsed row pictures
   * the one thing it was not taken for.
   */
  expandToolCards?: boolean
  /**
   * A control to click before capturing.
   *
   * Two sandboxes mount idle — "No items yet. Click Stream to start."
   * — so a shot taken on arrival pictures an empty box where the
   * subject should be. Both were captured that way on the first pass.
   */
  click?: RegExp
  /**
   * What has to be on the page before the shot is taken.
   *
   * A fixed `settleMs` is a guess about how long a machine takes, and
   * under x86_64 emulation two screens failed their own baselines once
   * in six runs — then passed five times, which is the worst evidence
   * there is. Waiting for the thing itself removes the class.
   */
  ready?: { selector: string; count?: number }
  /**
   * The desktop shell to stand in for, on a screen drawn as a desktop
   * window sees it: `invoke("backend_state")` answers `snapshot` (the
   * shell's wire names), and an extension page asked of the shell
   * (`cloud_page_origin`) is served at `pages.origin` with `pages.html`.
   */
  desktop?: {
    snapshot: Record<string, unknown>
    pages?: { origin: string; html: string; ready: string }
  }
  /**
   * Checked by axe in the light theme too, not only the dark (the
   * accessibility spec's default). The Local / Cloud switch's screens
   * are: §12.1 asks for both.
   */
  axeBothThemes?: boolean
}

/** A snapshot as the desktop shell pushes it (`cloud/switchboard.rs`). */
function shellSnapshot(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    side: 'local',
    state: 'local',
    reason: null,
    detail: null,
    credential_warning: false,
    mode: 'local_and_cloud',
    cloud: 'available',
    cloud_reason: null,
    switch_visible: true,
    chip_visible: true,
    can_use_local: true,
    can_use_cloud: true,
    backend_key: 'local',
    local_activity: { runs: 0, approvals: 0 },
    notice: null,
    vm: null,
    group_name: 'Engineering',
    retry_in_ms: null,
    ...overrides,
  }
}

/** The extension's own page, as the shell's origin for it serves it. */
const CLOUD_EXTENSION_PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reviews</title>',
  '<style>body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#ffffff;color:#1f1f1f}',
  'main{padding:16px}h1{font-size:18px;margin:0 0 8px}</style></head>',
  // Named, so its landmark is told apart from the window's own <main>.
  '<body><main aria-label="Reviews"><h1 id="from-the-cloud">Reviews from the cloud</h1>',
  '<p>Three changes are waiting for a review.</p></main></body></html>',
].join('')

export const APP_SCREENS: readonly AppScreen[] = [
  // The chat surface, in the states that exercise its renderers.
  {
    name: '01-conversation',
    demo: 'team',
    scenario: /Team — inside a real conversation/i,
    ready: { selector: '.orchestrate-head' },
  },
  { name: '02-kitchen-sink', demo: 'team', scenario: /Kitchen sink/i },
  {
    name: '03-markdown',
    demo: 'team',
    scenario: /Markdown rendering/i,
    // mermaid is a dynamic import of ~700KB rendering ten diagrams.
    // Waiting for all ten, not for 2.5 seconds: this is the screen
    // that flaked, and D7 established the count.
    ready: { selector: 'svg[aria-roledescription], svg[id^="mermaid"]', count: 10 },
    settleMs: 1_200,
  },
  {
    name: '04-edit-tools',
    demo: 'team',
    scenario: /Edit tools/i,
    expandToolCards: true,
    ready: { selector: '.diff-table', count: 3 },
  },
  {
    name: '05-tool-states',
    demo: 'team',
    scenario: /Tool states/i,
    expandToolCards: true,
  },
  { name: '06-long-thinking', demo: 'team', scenario: /Long thinking block/i },
  { name: '07-wall-of-tools', demo: 'team', scenario: /30 tool calls/i },

  // Orchestration.
  {
    name: '08-broadcast',
    demo: 'team',
    scenario: /Broadcast — three specialists/i,
  },
  {
    name: '09-broadcast-error',
    demo: 'team',
    scenario: /one specialist errored/i,
  },
  { name: '10-single-agent', demo: 'team', scenario: /Single agent/i },
  {
    name: '11-paused-for-approval',
    demo: 'team',
    scenario: /Sub-agent paused waiting/i,
  },

  // Human-in-the-loop.
  { name: '12-hitl-single', demo: 'team', scenario: /HITL — one approval/i },
  { name: '13-hitl-batched', demo: 'team', scenario: /three approvals batched/i },

  // Everything with its own sandbox.
  { name: '14-plan-mode', demo: 'plan' },
  // Straight to the finished run: the streaming variants are a
  // different shot on every frame and cannot be compared.
  {
    name: '15-workflow',
    demo: 'workflow',
    click: /Jump to success/i,
    ready: { selector: '[data-status="done"]' },
  },
  { name: '16-interrupted', demo: 'interrupted' },
  {
    name: '17-visualizer',
    demo: 'viz-stream',
    click: /One-shot/i,
    ready: { selector: '[data-status="done"]' },
  },
  // The desktop's cloud switch: the control, the chip, every banner.
  {
    name: '18-cloud-switch',
    demo: 'cloud',
    ready: { selector: '.backend-banner', count: 9 },
  },
  // And each piece alone (design §12.1, §15.7), in both themes for axe.
  {
    name: '19-cloud-switch-under-composer',
    demo: 'cloud&part=switch',
    ready: { selector: '.backend-switch-badge' },
    axeBothThemes: true,
  },
  {
    name: '20-cloud-chip-states',
    demo: 'cloud&part=chips',
    ready: { selector: '.backend-chip', count: 4 },
    axeBothThemes: true,
  },
  {
    name: '21-cloud-banner-needs-sign-in',
    demo: 'cloud&part=banner-sign-in',
    ready: { selector: '.backend-banner' },
    axeBothThemes: true,
  },
  {
    name: '22-cloud-banner-unreachable',
    demo: 'cloud&part=banner-unreachable',
    ready: { selector: '.backend-banner' },
    axeBothThemes: true,
  },
  {
    name: '23-cloud-banner-refused',
    demo: 'cloud&part=banner-refused',
    ready: { selector: '.backend-banner' },
    axeBothThemes: true,
  },
  {
    name: '24-cloud-banner-mode-change',
    demo: 'cloud&part=banner-mode-change',
    ready: { selector: '.backend-banner', count: 3 },
    axeBothThemes: true,
  },
  {
    name: '25-cloud-extension-page',
    demo: 'cloud&part=extension&side=cloud&backend=cloud-0123456789ab',
    desktop: {
      snapshot: shellSnapshot({ side: 'cloud', state: 'cloud_ready', backend_key: 'cloud-0123456789ab' }),
      pages: { origin: 'http://127.0.0.1:59111', html: CLOUD_EXTENSION_PAGE, ready: '#from-the-cloud' },
    },
    ready: { selector: '[data-testid="cloud-extension"] iframe' },
    axeBothThemes: true,
  },
]
