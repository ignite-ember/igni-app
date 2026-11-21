//! Fakes of the other lanes' contracts for the cloud tests: a scripted
//! HTTP server standing in for igni server's `/v1/me/cloud` and the
//! gateway's HTTP routes.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

/// Answers each request with the next scripted `(status, body)` and keeps
/// what it was sent, head and body, one string per request.
pub(crate) struct FakeHttp {
    port: u16,
    requests: Arc<Mutex<Vec<String>>>,
}

impl FakeHttp {
    pub fn start(script: Vec<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        std::thread::spawn(move || {
            for (status, body) in script {
                let Ok((stream, _)) = listener.accept() else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                let mut length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                    head.push_str(&line);
                }
                let mut content = vec![0u8; length];
                let _ = reader.read_exact(&mut content);
                head.push_str(&String::from_utf8_lossy(&content));
                seen.lock().unwrap().push(head);
                let mut stream = stream;
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        FakeHttp { port, requests }
    }

    /// Answer every request whose request line starts with a route's
    /// prefix (`"GET /v1/me/cloud"`) with that route's answer, for as many
    /// requests as come; anything else gets 404.
    pub fn routes(routes: Vec<(&'static str, u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                let mut length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                    head.push_str(&line);
                }
                let mut content = vec![0u8; length];
                let _ = reader.read_exact(&mut content);
                head.push_str(&String::from_utf8_lossy(&content));
                let (status, body) = routes
                    .iter()
                    .find(|(prefix, _, _)| head.starts_with(prefix))
                    .map(|(_, status, body)| (*status, body.clone()))
                    .unwrap_or((404, "{}".to_string()));
                seen.lock().unwrap().push(head);
                let mut stream = stream;
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        FakeHttp { port, requests }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn requests(&self) -> Vec<String> {
        // The server thread records before it answers, so by the time a
        // call has returned its request is here.
        self.requests.lock().unwrap().clone()
    }

    /// A loopback port nothing listens on.
    pub fn dead_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }
}
