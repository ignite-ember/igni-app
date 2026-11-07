//! The JOSE half of a pack: base64url segments, the JWS header, the JWKS.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Deserializer};

use super::error::{PackError, SegmentError};

/// The JWS `typ` igni server puts on a pack.
pub(crate) const PACK_TYPE: &str = "igni-group-policy+jwt";

/// The only algorithm igni server signs packs with.
const ALGORITHM: &str = "RS256";

pub(crate) fn b64(segment: &str) -> Result<Vec<u8>, SegmentError> {
    URL_SAFE_NO_PAD.decode(segment.trim_end_matches('=')).map_err(|_| SegmentError::NotBase64)
}

pub(crate) fn decode_json<T: DeserializeOwned>(segment: &str) -> Result<T, SegmentError> {
    serde_json::from_slice(&b64(segment)?).map_err(|_| SegmentError::NotJson)
}

/// The protected header of a compact JWS.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct JwsHeader {
    /// Whether `crit` is there at all, whatever it holds.
    #[serde(default, deserialize_with = "present")]
    crit: bool,
    typ: Option<String>,
    alg: Option<String>,
    kid: Option<String>,
}

fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    IgnoredAny::deserialize(deserializer).map(|_| true)
}

impl JwsHeader {
    /// The `kid` to look up, once the header is one igni server writes on a pack.
    pub(crate) fn checked_kid(&self) -> Result<&str, PackError> {
        if self.crit {
            return Err(PackError::CriticalHeader);
        }
        if self.typ.as_deref() != Some(PACK_TYPE) {
            return Err(PackError::NotAPack);
        }
        if self.alg.as_deref() != Some(ALGORITHM) {
            return Err(PackError::NotRs256);
        }
        Ok(self.kid.as_deref().unwrap_or(""))
    }
}

/// One key of a JWKS. Only RSA keys are ever used.
#[derive(Debug, Default, Clone, Deserialize)]
pub(crate) struct Jwk {
    pub kty: Option<String>,
    pub kid: Option<String>,
    pub n: Option<String>,
    pub e: Option<String>,
}

impl Jwk {
    fn is_rsa(&self) -> bool {
        self.kty.as_deref() == Some("RSA")
    }

    /// RFC 7638 thumbprint of an RSA JWK — the value an administrator pins.
    pub(crate) fn thumbprint(&self) -> Option<String> {
        let (e, n) = (self.e.as_deref()?, self.n.as_deref()?);
        // Members in lexicographic order, no whitespace (RFC 7638 §3).
        let canonical = format!("{{\"e\":\"{e}\",\"kty\":\"RSA\",\"n\":\"{n}\"}}");
        let digest = ring::digest::digest(&ring::digest::SHA256, canonical.as_bytes());
        Some(URL_SAFE_NO_PAD.encode(digest.as_ref()))
    }

    /// Whether `signature` is this key's RS256 signature over `input`.
    fn verifies(&self, input: &[u8], signature: &[u8]) -> bool {
        let decoded = |part: &Option<String>| part.as_deref().and_then(|p| b64(p).ok());
        let (Some(n), Some(e)) = (decoded(&self.n), decoded(&self.e)) else {
            return false;
        };
        ring::signature::RsaPublicKeyComponents { n: &n, e: &e }
            .verify(&ring::signature::RSA_PKCS1_2048_8192_SHA256, input, signature)
            .is_ok()
    }
}

/// The key set cached beside the pack.
#[derive(Debug, Default, Clone, Deserialize)]
pub(crate) struct Jwks {
    #[serde(default)]
    pub keys: Vec<Jwk>,
}

impl Jwks {
    /// The cached file's keys; an unreadable file holds none.
    pub(crate) fn from_text(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or_default()
    }

    /// Checks `signature` over `input` against the RSA keys that match `kid`
    /// (any, when it is empty) and, when there are pins, are pinned.
    pub(crate) fn verify(&self, kid: &str, pins: &[String], input: &[u8], signature: &str) -> Result<(), PackError> {
        let candidates: Vec<&Jwk> = self
            .keys
            .iter()
            .filter(|k| k.is_rsa())
            .filter(|k| kid.is_empty() || k.kid.as_deref() == Some(kid))
            .filter(|k| pins.is_empty() || k.thumbprint().is_some_and(|t| pins.contains(&t)))
            .collect();
        if candidates.is_empty() {
            return Err(if pins.is_empty() { PackError::NoKey } else { PackError::NoPinnedKey });
        }
        let signature = b64(signature).map_err(PackError::Signature)?;
        if candidates.iter().any(|key| key.verifies(input, &signature)) {
            Ok(())
        } else {
            Err(PackError::SignatureMismatch)
        }
    }
}
