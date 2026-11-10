//! The last lines of the backend's stderr, kept for a failure message.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Drained on its own thread from spawn onwards: a traceback outgrows the
/// pipe buffer, and reading it only after a failure would leave the
/// backend blocked on a full pipe while the shell waits for a ready line.
pub(crate) struct StderrTail {
    lines: Arc<Mutex<VecDeque<String>>>,
    drainer: JoinHandle<()>,
}

impl StderrTail {
    /// Enough for the end of a traceback, which names the exception.
    pub const CAPACITY: usize = 40;

    pub fn drain(stderr: impl Read + Send + 'static) -> Self {
        let lines = Arc::new(Mutex::new(VecDeque::with_capacity(Self::CAPACITY)));
        let writer = Arc::clone(&lines);
        let drainer = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                Self::push_bounded(&writer, line);
            }
        });
        StderrTail { lines, drainer }
    }

    fn push_bounded(lines: &Mutex<VecDeque<String>>, line: String) {
        let mut kept = lines.lock().unwrap_or_else(|e| e.into_inner());
        if kept.len() == Self::CAPACITY {
            kept.pop_front();
        }
        kept.push_back(line);
    }

    /// Give the drain thread up to `max` to finish reading what a dead
    /// process wrote; returns as soon as it does.
    pub fn wait_for_drain(&self, max: Duration) {
        let deadline = Instant::now() + max;
        while !self.drainer.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
    }

    /// The last non-blank line, which for a traceback is the exception.
    pub fn last_meaningful_line(&self) -> String {
        let kept = self.lines.lock().unwrap_or_else(|e| e.into_inner());
        kept.iter()
            .rev()
            .find(|l| !l.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "no output on stderr".to_string())
    }

    #[cfg(test)]
    fn kept(&self) -> Vec<String> {
        self.lines
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn drained(text: String) -> StderrTail {
        let tail = StderrTail::drain(Cursor::new(text.into_bytes()));
        tail.wait_for_drain(Duration::from_secs(5));
        tail
    }

    #[test]
    fn blank_lines_are_skipped_for_the_reason() {
        let tail = drained("Traceback\nValueError: bad model\n\n   \n".to_string());
        assert_eq!(tail.last_meaningful_line(), "ValueError: bad model");
    }

    #[test]
    fn silence_is_said_out_loud() {
        assert_eq!(
            drained(String::new()).last_meaningful_line(),
            "no output on stderr"
        );
    }

    #[test]
    fn only_the_last_lines_are_kept() {
        let text: String = (0..50).map(|i| format!("line {i}\n")).collect();
        let kept = drained(text).kept();
        assert_eq!(kept.len(), StderrTail::CAPACITY);
        assert_eq!(kept.first().map(String::as_str), Some("line 10"));
        assert_eq!(kept.last().map(String::as_str), Some("line 49"));
    }
}
