//! A local HTTPS server for the tests of the shell's HTTPS clients.
//!
//! Its certificate (`tests/fixtures/untrusted-tls/leaf.der`, for
//! mirror.igni.test, localhost and 127.0.0.1) is signed by a throwaway CA
//! whose key was discarded. That CA is in no trust store, so every client
//! must refuse the server; a test that wants the CA trusted runs in a child
//! process whose `SSL_CERT_FILE` names `ca.pem`, which on Linux is the
//! system bundle the platform verifier reads (and which a compiled-in root
//! list would ignore).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/untrusted-tls").join(name)
}

/// Answers every request, on every path, with `body`, once the handshake
/// is through; a client that refuses the certificate never gets that far.
pub(crate) struct TestMirror {
    port: u16,
}

impl TestMirror {
    pub fn start(body: impl Into<String>) -> Self {
        let body: Arc<str> = body.into().into();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![rustls::pki_types::CertificateDer::from(std::fs::read(fixture("leaf.der")).unwrap())],
                rustls::pki_types::PrivateKeyDer::Pkcs8(std::fs::read(fixture("leaf.key.der")).unwrap().into()),
            )
            .unwrap();
        let config = Arc::new(config);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (config, body) = (config.clone(), body.clone());
                std::thread::spawn(move || {
                    let mut stream = stream;
                    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
                    let mut conn = rustls::ServerConnection::new(config).unwrap();
                    let mut tls = rustls::Stream::new(&mut conn, &mut stream);
                    let mut reader = BufReader::new(&mut tls);
                    let mut line = String::new();
                    // The request head; a refused handshake ends here.
                    loop {
                        line.clear();
                        match reader.read_line(&mut line) {
                            Ok(0) | Err(_) => return,
                            Ok(_) if line == "\r\n" => break,
                            Ok(_) => {}
                        }
                    }
                    let _ = write!(
                        tls,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = tls.flush();
                    tls.conn.send_close_notify();
                    let _ = tls.flush();
                });
            }
        });
        TestMirror { port }
    }

    pub fn url(&self, path: &str) -> String {
        format!("https://127.0.0.1:{}{path}", self.port)
    }
}

/// Run the `#[ignore]`d test `name` (its full path) in a child process of
/// this test binary whose `SSL_CERT_FILE` holds the throwaway CA alone,
/// and fail unless it passed. Linux only: there the platform verifier
/// reads the system bundle through rustls-native-certs, which honours
/// `SSL_CERT_FILE`; Security.framework and CryptoAPI do not.
#[cfg(target_os = "linux")]
pub(crate) fn passes_trusting_the_test_ca(name: &str) {
    let out = std::process::Command::new(std::env::current_exe().unwrap())
        .args([name, "--exact", "--ignored", "--nocapture", "--test-threads=1"])
        .env("SSL_CERT_FILE", fixture("ca.pem"))
        .env_remove("SSL_CERT_DIR")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success() && stdout.contains("1 passed"),
        "{name} with the test CA in the system bundle:\n{stdout}\n{stderr}"
    );
}
