//! Where the organisation lets igni run for this person, and what the
//! switch may therefore offer.
//!
//! The group's `mode` reaches the shell two ways: the signed group pack
//! (offline, verified like every other pack setting, `group_pack/`) and
//! igni server's `/v1/me/cloud` (fresher, since the pack is polled every
//! five minutes). The two read unknown values differently, each in its
//! safe direction: the pack follows igni-core's `GroupPolicyPack` (absent
//! or unknown is `local_and_cloud`, today's behaviour), discovery follows
//! its contract (an unknown mode counts as `local`).

use serde::Serialize;

/// The group's mode (`org_groups.mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GroupMode {
    /// igni runs on this computer only; the shell never dials.
    Local,
    /// igni runs in the cloud only; no full local backend is spawned.
    Cloud,
    /// Both, with the switch.
    LocalAndCloud,
}

impl GroupMode {
    /// The mode a verified pack states. Absent or unknown is
    /// `local_and_cloud`, as igni-core reads it.
    pub fn from_pack(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("local") => GroupMode::Local,
            Some("cloud") => GroupMode::Cloud,
            _ => GroupMode::LocalAndCloud,
        }
    }

    /// The mode `/v1/me/cloud` states. Unknown is `local`, the contract's
    /// safe direction; absent cannot happen in a valid answer and reads
    /// the same way.
    pub fn from_discovery(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("cloud") => GroupMode::Cloud,
            Some("local_and_cloud") => GroupMode::LocalAndCloud,
            _ => GroupMode::Local,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            GroupMode::Local => "local",
            GroupMode::Cloud => "cloud",
            GroupMode::LocalAndCloud => "local_and_cloud",
        }
    }

    /// Whether this computer's own backend may run the chat.
    pub fn allows_local(self) -> bool {
        self != GroupMode::Cloud
    }
}

/// Whether igni server says this person has a cloud igni to use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "cloud", content = "reason", rename_all = "snake_case")]
pub(crate) enum CloudAvailability {
    /// Not asked yet, or igni server could not be reached.
    Unknown,
    Available,
    /// With the server's reason (`fleet_not_configured`, `group_local_only`,
    /// `inactive`, `not_licensed`, or one this build does not know).
    Unavailable(String),
}

/// The mode and the availability together: what the switch offers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SidePolicy {
    pub mode: GroupMode,
    pub availability: CloudAvailability,
}

impl SidePolicy {
    /// The control is shown only for a person with a cloud igni in a
    /// group that offers both sides.
    pub fn switch_visible(&self) -> bool {
        self.mode == GroupMode::LocalAndCloud && self.availability == CloudAvailability::Available
    }

    /// Whether a switch to the cloud may be made. In `cloud` mode an
    /// unknown availability still counts (offline, the app stays on the
    /// cloud and says it is unreachable); in `local_and_cloud` the person
    /// switches only to a cloud igni server has confirmed.
    pub fn may_use_cloud(&self) -> bool {
        match self.mode {
            GroupMode::Local => false,
            GroupMode::Cloud => !matches!(self.availability, CloudAvailability::Unavailable(_)),
            GroupMode::LocalAndCloud => self.availability == CloudAvailability::Available,
        }
    }

    pub fn may_use_local(&self) -> bool {
        self.mode.allows_local()
    }

    /// Whether the chip shows at all: in `cloud` mode always (with no
    /// control), in `local_and_cloud` with the switch.
    pub fn chip_visible(&self) -> bool {
        self.mode == GroupMode::Cloud || self.switch_visible()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pack_reads_absent_and_unknown_as_both() {
        assert_eq!(GroupMode::from_pack(None), GroupMode::LocalAndCloud);
        assert_eq!(GroupMode::from_pack(Some("hybrid")), GroupMode::LocalAndCloud);
        assert_eq!(GroupMode::from_pack(Some("local")), GroupMode::Local);
        assert_eq!(GroupMode::from_pack(Some(" cloud ")), GroupMode::Cloud);
        assert_eq!(GroupMode::from_pack(Some("local_and_cloud")), GroupMode::LocalAndCloud);
    }

    #[test]
    fn discovery_reads_unknown_as_local() {
        assert_eq!(GroupMode::from_discovery(Some("hybrid")), GroupMode::Local);
        assert_eq!(GroupMode::from_discovery(None), GroupMode::Local);
        assert_eq!(GroupMode::from_discovery(Some("cloud")), GroupMode::Cloud);
        assert_eq!(GroupMode::from_discovery(Some("local_and_cloud")), GroupMode::LocalAndCloud);
    }

    fn policy(mode: GroupMode, availability: CloudAvailability) -> SidePolicy {
        SidePolicy { mode, availability }
    }

    #[test]
    fn the_switch_shows_only_for_both_sides_and_an_available_cloud() {
        use CloudAvailability::*;
        assert!(policy(GroupMode::LocalAndCloud, Available).switch_visible());
        assert!(!policy(GroupMode::LocalAndCloud, Unknown).switch_visible());
        assert!(!policy(GroupMode::LocalAndCloud, Unavailable("inactive".into())).switch_visible());
        assert!(!policy(GroupMode::Cloud, Available).switch_visible(), "cloud mode has no control");
        assert!(!policy(GroupMode::Local, Available).switch_visible());
    }

    #[test]
    fn the_chip_shows_in_cloud_mode_without_a_control_and_never_in_local_mode() {
        use CloudAvailability::*;
        assert!(policy(GroupMode::Cloud, Unknown).chip_visible());
        assert!(policy(GroupMode::LocalAndCloud, Available).chip_visible());
        assert!(!policy(GroupMode::LocalAndCloud, Unknown).chip_visible());
        assert!(!policy(GroupMode::Local, Available).chip_visible());
    }

    #[test]
    fn which_sides_may_be_used() {
        use CloudAvailability::*;
        assert!(!policy(GroupMode::Local, Available).may_use_cloud());
        assert!(policy(GroupMode::Local, Available).may_use_local());
        assert!(policy(GroupMode::Cloud, Unknown).may_use_cloud(), "offline cloud mode stays on the cloud");
        assert!(!policy(GroupMode::Cloud, Unavailable("inactive".into())).may_use_cloud());
        assert!(!policy(GroupMode::Cloud, Available).may_use_local());
        assert!(policy(GroupMode::LocalAndCloud, Available).may_use_cloud());
        assert!(!policy(GroupMode::LocalAndCloud, Unknown).may_use_cloud());
        assert!(policy(GroupMode::LocalAndCloud, Unknown).may_use_local());
    }
}
