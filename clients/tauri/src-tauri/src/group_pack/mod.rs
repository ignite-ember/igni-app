//! The organisation's group policy, as the desktop shell may trust it.
//!
//! The backend caches each person's group pack exactly as igni server signed
//! it — a compact JWS, `~/.igni/group-policy/pack.jws` — and applies it only
//! after verifying it (`core/config/group_policy_signature.py`). This shell
//! reads four settings itself (`air_gapped`, `update_endpoint`,
//! `update_check_ttl`, `runtime_python`) before there is a backend, so it
//! verifies the same pack the same way rather than trusting the directory it
//! sits in. It used to read an unsigned `group_settings.json`, which anybody
//! who could write the directory could edit; that file is no longer written
//! and never read.
//!
//! Checked, in this order: the JWS header (`typ`, RS256, no `crit`); the
//! signature, against a key from the JWKS cached beside the pack — only a
//! key whose RFC 7638 thumbprint is pinned, when `group_policy.trusted_keys`
//! pins any (managed file or `IGNI_GROUP_POLICY_TRUSTED_KEYS`); `token_use`;
//! `iss` against `api_url`; `sub` against the person signed in; `version`
//! not older than the newest pack the backend accepted. Anything failing is
//! no group layer at all. Without a pin the cached JWKS is only as
//! trustworthy as the directory: it stops a stray or planted file, not the
//! machine's own user. The backend, not this shell, enforces
//! `group_policy.required`.
//!
//! RS256 only: it is the only algorithm igni server signs packs with. `ring`
//! is already in the build (through rustls), so verifying here costs no new
//! crate.

mod error;
mod jose;
mod local_state;
mod pins;
mod policy;

use serde::Deserialize;

pub(crate) use error::PackError;
pub(crate) use jose::Jwks;
pub(crate) use local_state::{subject_from_credentials, PackState};
pub(crate) use pins::{pins_from_env, pins_from_managed, TRUSTED_KEYS_ENV};
pub(crate) use policy::GroupPolicy;

use jose::{decode_json, JwsHeader};

/// What a pack is checked against.
#[derive(Debug, Default, Clone)]
pub(crate) struct Trust {
    pub api_url: Option<String>,
    pub subject: Option<String>,
    pub pins: Vec<String>,
    pub min_version: Option<i64>,
}

/// The claims igni server signs into a pack.
#[derive(Debug, Deserialize)]
struct PackClaims {
    token_use: Option<String>,
    iss: Option<String>,
    sub: Option<String>,
    version: Option<i64>,
    policy: Option<GroupPolicy>,
}

impl PackClaims {
    /// The policy, once the claims say it was issued for this install.
    fn into_policy(self, trust: &Trust) -> Result<GroupPolicy, PackError> {
        if self.token_use.as_deref() != Some("group_policy") {
            return Err(PackError::NotAPack);
        }
        let expected = trust
            .api_url
            .as_deref()
            .map(normalise_issuer)
            .filter(|s| !s.is_empty())
            .ok_or(PackError::ApiUrlUnset)?;
        if self.iss.as_deref().map(normalise_issuer).as_deref() != Some(expected.as_str()) {
            return Err(PackError::OtherIssuer);
        }
        let subject = trust.subject.as_deref().filter(|s| !s.is_empty()).ok_or(PackError::NobodySignedIn)?;
        if self.sub.as_deref() != Some(subject) {
            return Err(PackError::OtherSubject);
        }
        let version = self.version.ok_or(PackError::NoVersion)?;
        if trust.min_version.is_some_and(|min| version < min) {
            return Err(PackError::Rollback);
        }
        self.policy.ok_or(PackError::NoPolicy)
    }
}

/// `scheme://host[:port][/path]`, host lower-cased, no trailing slash.
pub(crate) fn normalise_issuer(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let (host, path) = match rest.find('/') {
                Some(i) => (&rest[..i], &rest[i..]),
                None => (rest, ""),
            };
            format!("{}://{}{}", scheme.to_ascii_lowercase(), host.to_ascii_lowercase(), path)
        }
        None => url.to_string(),
    }
}

/// The policy of a pack igni server signed for this install, or why not.
pub(crate) fn verify(compact: &str, jwks: &Jwks, trust: &Trust) -> Result<GroupPolicy, PackError> {
    let parts: Vec<&str> = compact.trim().split('.').collect();
    let [head, payload, signature] = parts.as_slice() else {
        return Err(PackError::NotCompact);
    };
    let header: JwsHeader = decode_json(head).map_err(PackError::Header)?;
    let kid = header.checked_kid()?;
    jwks.verify(kid, &trust.pins, format!("{head}.{payload}").as_bytes(), signature)?;
    let claims: PackClaims = decode_json(payload).map_err(PackError::Payload)?;
    claims.into_policy(trust)
}

#[cfg(test)]
mod tests {
    use super::jose::{Jwk, PACK_TYPE};
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use ring::rand::SystemRandom;
    use serde_json::Value;
    use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};

    // A 2048-bit RSA key, PKCS#8 DER in standard base64, generated once for
    // these tests: `ring` verifies and signs RSA but does not generate keys.
    const TEST_KEY_PKCS8: &[&str] = &[
        "MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCo/LvU3Ep/4uyB1PWRGb2TAMONPlJOJo0bAVO7QOvWjGL5",
        "5upnqG+fJfrMPRjeLjH4qwNMnc39zmMz5OLcT8SrHLyREM4IwhpRtcFzOiRZrR9TAgoz0EDvshfQoCy7h/YSS+QQYWKVt0R6",
        "W3MKrMupvS0byCRoS5jLiDj+/f72YL/XnhWfDxmsa/pkRQcjCAKuwUNFFgczM9JWyYAT2GeKYwb4WIOivVCjQd+gnbRLewJy",
        "xMQ6uZstk1GBAKKGOOcAF2/U7E4lQG7jMCNGWw4LfmMkVyDQjgFmLsA9xdXSYWrIB+8vD2G3d/JM8Mk9QUAZzoH5f5QxB5fH",
        "vt0Eye57AgMBAAECggEABif64cTKtAD807gB4DDbXqUa+qTIE8/EuTShq8MwNEc1/dujM3aH5njYO6OIKePt7xyvyJVBIVto",
        "8sWGXDdNt1wbJH/Dub70fYCNFRkLpPaxGvGKlJukGfdXdcK4DnbkCIOaQdyCXmjoRjrZpIxp+PuKzqXKacBDRzrltKhlJu2N",
        "NMhw1tkkKxzzUJ8EnaTmRsIvjUZxVZBH1k3n0g6NMnWCDHfWDbhkEutGRI1NLHH9QWqD2C1KiGTWUAsBdsvHDycDii0icQKp",
        "hTNud05fxnzk63aCGeYIF20XMPodPnZqETfxWor9IQ6iUlC7yQtZdkBL0O9gflrMlYTE42kh9QKBgQDYuGEamt42gHm+wlx7",
        "J8Zylrn18jLyT5HQnfnFrieVg176CTcDguUcclbtitMLhN++Sy+9tfDJzkkb1lNTedNnnqraaQyw7QrFujHgmnrN46S7IdHu",
        "Za0Yw+gJPAt/6Q+t6SzjsWspffuA+rhb9K0pFfzfkRXJUksZy0r25GaA9QKBgQDHnZZW7lGyTafhSaBb36TcorpxJCMwxF1J",
        "O2K4aueji09Eo98EwX4MsvHJu8TKlDF3lEeHAebRg2KUycqwDghVn7bRBKaOyEFmDUfaQyJYniesJ0CsV6vHnPL1nnVQAXtI",
        "yPsLOWjaISvgQEEZ8JX3Nj2aV1gAMJJAgxbx2TBLrwKBgQDC5f4d6QzSQvQ6A50b/IdRYg/XCXubwsdFr+yCRL7AjSaLAmKB",
        "O+RDkuhuNBzcDSESh5dlqwvi0SuaZ0MEnVjrpRvN1A9fxa2caHiWnxa1tnXc/OtI1BO5Y+V2+JL282fwZPTDyDixVeUq9095",
        "Ey/u9SE3BclsBiAYEGVYZ8tvSQKBgQCvGX0XJFZlodjxtjQEY1mqcNQ7CwgTbyylYIJoYt5uh3UxMM4gzdpUKWQPIbauPPBn",
        "hJp5wyFGB4oiGiDB7o1BDqi/EOVJukAj1OKCgwFN2u3SBVyl0QHOR86XxjgBxkruvd35KpLfRNnIDJUOvAvQnrPK/3MiN3kT",
        "PeqSm4HR4QKBgQCnYGtBw/eJCiBdZ04o4xHY7YuYRUrLcKkNxBj6CvBJ6wQqcEAA0lP4yY/ykSzIB2SwHHOLUOTOnHyUUqCQ",
        "P+UuPoyclBOsrCp8VAvoRcHmvjYAg8YKjw6eUg5z4HdNextguv3E79OcISeaOWkeJ6SptyCVtEVm6AjOk2nrTNL80w==",
    ];

    fn key() -> RsaKeyPair {
        let der = base64::engine::general_purpose::STANDARD.decode(TEST_KEY_PKCS8.concat()).unwrap();
        RsaKeyPair::from_pkcs8(&der).expect("test key")
    }

    fn jwks(pair: &RsaKeyPair) -> Jwks {
        let components = ring::rsa::PublicKeyComponents::<Vec<u8>>::from(pair.public());
        let mut jwk = Jwk {
            kty: Some("RSA".into()),
            kid: None,
            n: Some(URL_SAFE_NO_PAD.encode(components.n)),
            e: Some(URL_SAFE_NO_PAD.encode(components.e)),
        };
        jwk.kid = jwk.thumbprint();
        Jwks { keys: vec![jwk] }
    }

    fn kid_of(keys: &Jwks) -> String {
        keys.keys[0].kid.clone().unwrap()
    }

    fn sign(pair: &RsaKeyPair, kid: &str, claims: &Value) -> String {
        let head = URL_SAFE_NO_PAD.encode(serde_json::json!({"alg": "RS256", "kid": kid, "typ": PACK_TYPE}).to_string());
        let body = URL_SAFE_NO_PAD.encode(claims.to_string());
        let input = format!("{head}.{body}");
        let mut signature = vec![0; pair.public().modulus_len()];
        pair.sign(&RSA_PKCS1_SHA256, &SystemRandom::new(), input.as_bytes(), &mut signature).unwrap();
        format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature))
    }

    fn claims(sub: &str, iss: &str, version: i64) -> Value {
        serde_json::json!({
            "iss": iss, "sub": sub, "org": "o", "iat": 1, "version": version,
            "token_use": "group_policy",
            "policy": {"entries": [{
                "kind": "settings", "entry_name": "p", "content_type": "json", "enabled": true,
                "content": "{\"air_gapped\": true, \"update_endpoint\": \"https://m.internal/l.json\"}"
            }]}
        })
    }

    fn trust() -> Trust {
        Trust { api_url: Some("https://igni.example.invalid/".into()), subject: Some("p1".into()), ..Trust::default() }
    }

    #[test]
    fn a_genuine_pack_verifies_and_yields_its_settings() {
        let pair = key();
        let keys = jwks(&pair);
        let kid = kid_of(&keys);
        let compact = sign(&pair, &kid, &claims("p1", "https://igni.example.invalid", 5));
        let policy = verify(&compact, &keys, &trust()).expect("verifies");
        let settings = crate::desktop_settings::DesktopSettings::from_json(&policy.settings_json());
        assert_eq!(settings.air_gapped, Some(true));
        assert_eq!(settings.update_endpoint.as_deref(), Some("https://m.internal/l.json"));
    }

    #[test]
    fn a_malformed_entry_does_not_cost_the_pack_its_settings() {
        let pair = key();
        let keys = jwks(&pair);
        let kid = kid_of(&keys);
        let mut odd = claims("p1", "https://igni.example.invalid", 5);
        odd["policy"]["entries"]
            .as_array_mut()
            .unwrap()
            .insert(0, serde_json::json!({"kind": "prompt", "content_type": "markdown", "content": ["not", "a", "string"]}));
        let policy = verify(&sign(&pair, &kid, &odd), &keys, &trust()).expect("verifies");
        let settings = crate::desktop_settings::DesktopSettings::from_json(&policy.settings_json());
        assert_eq!(settings.air_gapped, Some(true));
        assert_eq!(settings.update_endpoint.as_deref(), Some("https://m.internal/l.json"));
    }

    #[test]
    fn a_forged_or_misdirected_pack_does_not() {
        let pair = key();
        let keys = jwks(&pair);
        let kid = kid_of(&keys);
        let good = sign(&pair, &kid, &claims("p1", "https://igni.example.invalid", 5));

        // Edited payload, original signature.
        let parts: Vec<&str> = good.split('.').collect();
        let mut edited = claims("p1", "https://igni.example.invalid", 5);
        edited["policy"]["entries"] = Value::Array(vec![]);
        let forged = format!("{}.{}.{}", parts[0], URL_SAFE_NO_PAD.encode(edited.to_string()), parts[2]);
        assert_eq!(verify(&forged, &keys, &trust()).unwrap_err(), PackError::SignatureMismatch, "edited");

        // Another person, another server, a rollback, nobody signed in.
        let refused = |compact: &str, trust: &Trust| verify(compact, &keys, trust).unwrap_err();
        assert_eq!(refused(&sign(&pair, &kid, &claims("p2", "https://igni.example.invalid", 5)), &trust()), PackError::OtherSubject);
        assert_eq!(refused(&sign(&pair, &kid, &claims("p1", "https://other.invalid", 5)), &trust()), PackError::OtherIssuer);
        assert_eq!(refused(&good, &Trust { min_version: Some(6), ..trust() }), PackError::Rollback);
        assert_eq!(refused(&good, &Trust { subject: None, ..trust() }), PackError::NobodySignedIn);

        // Unsigned, or the plain JSON the cache used to hold.
        assert_eq!(refused("{\"air_gapped\": false}", &trust()), PackError::NotCompact);
        assert_eq!(refused(&format!("{}.{}.", parts[0], parts[1]), &trust()), PackError::SignatureMismatch);

        // A pin that is not this key refuses it, though the JWKS holds it.
        assert_eq!(refused(&good, &Trust { pins: vec!["not-it".into()], ..trust() }), PackError::NoPinnedKey);
        assert!(verify(&good, &keys, &Trust { pins: vec![kid.clone()], ..trust() }).is_ok());
    }
}
