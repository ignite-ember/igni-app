//! At most one folder picker on screen.
//!
//! Two concurrent picks wedge the app: AppKit presents the second panel
//! as a sheet on a window that already has one, orders the parent out,
//! and leaves the process running with no windows and no way back. Two
//! quick taps of Shift-Cmd-N were enough.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct PickSlot {
    in_flight: AtomicBool,
}

impl PickSlot {
    /// Claim the slot, or `None` when a picker is already up.
    pub fn try_claim(self: &Arc<Self>) -> Option<PickClaim> {
        (!self.in_flight.swap(true, Ordering::SeqCst)).then(|| PickClaim(Arc::clone(self)))
    }
}

/// Releases the slot however the picking thread ends: cancelled, failed
/// or done. A missed release would disable New Window for the session.
pub(crate) struct PickClaim(Arc<PickSlot>);

impl Drop for PickClaim {
    fn drop(&mut self) {
        self.0.in_flight.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_claim_is_refused() {
        let slot = Arc::new(PickSlot::default());
        let _first = slot.try_claim().expect("first claim");
        assert!(slot.try_claim().is_none());
    }

    #[test]
    fn dropping_the_claim_releases_the_slot() {
        let slot = Arc::new(PickSlot::default());
        drop(slot.try_claim().expect("first claim"));
        assert!(!slot.in_flight.load(Ordering::SeqCst));
    }

    #[test]
    fn the_slot_is_reusable_after_release() {
        let slot = Arc::new(PickSlot::default());
        drop(slot.try_claim());
        let again = slot.try_claim();
        assert!(again.is_some());
        drop(again);
        assert!(slot.try_claim().is_some());
    }
}
