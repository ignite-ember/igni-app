//! The backend's JSON ready handshake on stdout.

use serde::Deserialize;

/// `{"status": "ready", "ws_port": N, ...}`. Other fields are ignored.
#[derive(Deserialize)]
pub(crate) struct ReadyLine {
    status: String,
    ws_port: u64,
}

impl ReadyLine {
    /// The bound WebSocket port if `line` is the ready handshake, `None`
    /// for any other line (the backend logs to stdout during startup, so
    /// the read loop keeps going). A port above 65535 is not a port.
    pub fn parse(line: &str) -> Option<u16> {
        let ready: ReadyLine = serde_json::from_str(line.trim()).ok()?;
        if ready.status != "ready" {
            return None;
        }
        u16::try_from(ready.ws_port).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_line_parsed_returns_port() {
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":51234}"#),
            Some(51234)
        );
    }

    #[test]
    fn ready_line_with_extra_fields_ok() {
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":8080,"socket":"/tmp/x.sock"}"#),
            Some(8080)
        );
    }

    #[test]
    fn trailing_newline_doesnt_break_parse() {
        assert_eq!(
            ReadyLine::parse("{\"status\":\"ready\",\"ws_port\":1}\n"),
            Some(1)
        );
    }

    #[test]
    fn non_ready_status_returns_none() {
        // Other status events (warmup) must not be read as ready.
        assert_eq!(
            ReadyLine::parse(r#"{"status":"starting","ws_port":1234}"#),
            None
        );
    }

    #[test]
    fn non_json_line_returns_none() {
        assert_eq!(ReadyLine::parse("INFO loading sessions..."), None);
    }

    #[test]
    fn missing_ws_port_returns_none() {
        assert_eq!(ReadyLine::parse(r#"{"status":"ready"}"#), None);
    }

    #[test]
    fn ready_line_with_non_numeric_ws_port_returns_none() {
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":"oops"}"#),
            None
        );
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":true}"#),
            None
        );
    }

    #[test]
    fn ready_line_with_out_of_range_ws_port_returns_none() {
        // Was truncated with `as u16` onto an unrelated port.
        let line = format!(r#"{{"status":"ready","ws_port":{}}}"#, 1u64 << 40);
        assert_eq!(ReadyLine::parse(&line), None);
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":65536}"#),
            None
        );
        assert_eq!(
            ReadyLine::parse(r#"{"status":"ready","ws_port":65535}"#),
            Some(65535)
        );
    }
}
