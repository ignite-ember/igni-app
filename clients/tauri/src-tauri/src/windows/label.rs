//! Window labels. A label is a window's identity: it keys the persisted
//! `client_id`, and through it the session binding and draft
//! (`clientState.ts`).

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowLabel(String);

impl WindowLabel {
    /// The launch window, never re-issued. It maps an existing install
    /// onto its pre-multi-window `client_id`.
    pub const MAIN: &'static str = "main";

    pub fn main() -> Self {
        WindowLabel(Self::MAIN.to_string())
    }

    /// The lowest free `w-N` (N >= 2). Lowest-free rather than a counter,
    /// so a window closed and reopened gets its stored session back.
    pub fn next_free(existing: &[String]) -> Self {
        (2usize..)
            .map(|n| format!("w-{n}"))
            .find(|candidate| !existing.iter().any(|label| label == candidate))
            .map(WindowLabel)
            .expect("an unbounded range always has a free label")
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_extra_window_is_w2() {
        assert_eq!(
            WindowLabel::next_free(&["main".to_string()]).as_str(),
            "w-2"
        );
    }

    #[test]
    fn labels_climb_past_the_ones_in_use() {
        let open = vec!["main".to_string(), "w-2".to_string(), "w-3".to_string()];
        assert_eq!(WindowLabel::next_free(&open).as_str(), "w-4");
    }

    #[test]
    fn a_closed_label_is_reused() {
        let open = vec!["main".to_string(), "w-3".to_string()];
        assert_eq!(WindowLabel::next_free(&open).as_str(), "w-2");
    }
}
