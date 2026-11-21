//! The cloud code's log lines. They go to stderr like the rest of the
//! shell's, and under test they are also kept, so a test can assert what
//! was never written: the session token above all.

#[cfg(test)]
use std::sync::Mutex;

#[cfg(test)]
static CAPTURED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Write one line, prefixed `igni <part>:`.
pub(crate) fn line(part: &str, text: impl AsRef<str>) {
    let line = format!("igni {part}: {}", text.as_ref());
    eprintln!("{line}");
    #[cfg(test)]
    CAPTURED.lock().unwrap_or_else(|e| e.into_inner()).push(line);
}

/// Every line written so far in this test process.
#[cfg(test)]
pub(crate) fn captured() -> Vec<String> {
    CAPTURED.lock().unwrap_or_else(|e| e.into_inner()).clone()
}
