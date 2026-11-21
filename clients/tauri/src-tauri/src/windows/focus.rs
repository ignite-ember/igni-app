//! Which window last gained focus, from the window events, for when no
//! window reports focus when asked.

#[derive(Debug, Default)]
pub(crate) struct FocusTracker {
    last: Option<String>,
}

impl FocusTracker {
    /// A window gained (`true`) or lost focus. Losing it keeps the record:
    /// a menu click takes focus from the page first.
    pub fn note(&mut self, label: &str, focused: bool) {
        if focused {
            self.last = Some(label.to_string());
        }
    }

    pub fn forget(&mut self, label: &str) {
        if self.last.as_deref() == Some(label) {
            self.last = None;
        }
    }

    pub fn last(&self) -> Option<&str> {
        self.last.as_deref()
    }

    /// The window to act on: one that reports focus, else the last that
    /// gained it while it is still open. `None` leaves it to the caller.
    pub fn pick(states: &[(String, bool)], last: Option<&str>) -> Option<String> {
        if let Some((label, _)) = states.iter().find(|(_, focused)| *focused) {
            return Some(label.clone());
        }
        let last = last?;
        states
            .iter()
            .find(|(label, _)| label == last)
            .map(|(label, _)| label.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states(list: &[(&str, bool)]) -> Vec<(String, bool)> {
        list.iter().map(|(l, f)| (l.to_string(), *f)).collect()
    }

    #[test]
    fn a_window_that_reports_focus_wins() {
        let s = states(&[("main", false), ("w-2", true)]);
        assert_eq!(FocusTracker::pick(&s, Some("main")).as_deref(), Some("w-2"));
    }

    // R624 on Windows: no window reports focus while its page has it.
    #[test]
    fn when_none_reports_focus_the_last_to_gain_it_is_used() {
        let mut tracker = FocusTracker::default();
        tracker.note("main", true);
        tracker.note("w-2", true);
        tracker.note("w-2", false);
        let s = states(&[("main", false), ("w-2", false)]);
        assert_eq!(
            FocusTracker::pick(&s, tracker.last()).as_deref(),
            Some("w-2")
        );
    }

    #[test]
    fn a_closed_window_is_not_picked() {
        let mut tracker = FocusTracker::default();
        tracker.note("w-2", true);
        tracker.forget("w-2");
        assert_eq!(tracker.last(), None);
        let s = states(&[("main", false)]);
        assert_eq!(FocusTracker::pick(&s, Some("w-3")), None);
    }

    #[test]
    fn forgetting_another_window_keeps_the_record() {
        let mut tracker = FocusTracker::default();
        tracker.note("w-2", true);
        tracker.forget("main");
        assert_eq!(tracker.last(), Some("w-2"));
    }
}
