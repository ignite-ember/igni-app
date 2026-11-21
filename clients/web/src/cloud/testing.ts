/**
 * A snapshot as the desktop shell sends it, for the switch's tests and
 * the `?demo=cloud` sandbox. The wire names are the shell's
 * (`cloud/switchboard.rs` `BackendSnapshot`).
 */

export function shellSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    side: "local",
    state: "local",
    reason: null,
    detail: null,
    credential_warning: false,
    mode: "local_and_cloud",
    cloud: "available",
    cloud_reason: null,
    switch_visible: true,
    chip_visible: true,
    can_use_local: true,
    can_use_cloud: true,
    backend_key: "local",
    local_activity: { runs: 0, approvals: 0 },
    notice: null,
    vm: null,
    group_name: "Engineering",
    retry_in_ms: null,
    ...overrides,
  };
}
