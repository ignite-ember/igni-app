//! Asking igni server whether there is a cloud igni for this person
//! (`GET /v1/me/cloud`), telling it who pulls their events
//! (`PUT /v1/me/cloud/events-owner`), and asking the gateway how the VM
//! is right now (`GET /v1/me`) and to sign it in (`POST /v1/sign-in`).
//!
//! The answers are read the way the contract
//! (`cloud-discovery.schema.json`) says a client must: unknown fields are
//! ignored, an unknown `cloud` counts as `unavailable` and an unknown
//! `mode` as `local`, and `reason` is an open set.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::gateway::GatewayUrl;
use crate::error::CauseChain;
use super::mode::{CloudAvailability, GroupMode};
use super::net;
use super::session::Session;

/// Who pulls this person's service events (§7).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EventsOwner {
    Local,
    Cloud,
}

impl EventsOwner {
    pub fn as_str(self) -> &'static str {
        match self {
            EventsOwner::Local => "local",
            EventsOwner::Cloud => "cloud",
        }
    }
}

/// The group, for display.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct GroupRef {
    pub id: String,
    pub name: String,
}

/// `/v1/me/cloud`'s answer, read leniently.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CloudDiscovery {
    pub availability: CloudAvailability,
    pub gateway_url: Option<String>,
    pub mode: GroupMode,
    pub events_owner: EventsOwner,
    pub group: Option<GroupRef>,
    pub producer: Option<String>,
}

impl CloudDiscovery {
    /// Read an answer's JSON text.
    pub fn parse(text: &str) -> Result<Self, DiscoveryError> {
        let Ok(Value::Object(map)) = serde_json::from_str::<Value>(text) else {
            return Err(DiscoveryError::BadAnswer);
        };
        let string = |key: &str| map.get(key).and_then(Value::as_str).map(str::to_string);
        let gateway_url = string("gateway_url").filter(|u| !u.trim().is_empty());
        let availability = match string("cloud").as_deref() {
            Some("available") if gateway_url.is_some() => CloudAvailability::Available,
            Some("available") => CloudAvailability::Unavailable("fleet_not_configured".into()),
            _ => CloudAvailability::Unavailable(string("reason").unwrap_or_else(|| "unavailable".into())),
        };
        let events_owner = match string("events_owner").as_deref() {
            Some("cloud") => EventsOwner::Cloud,
            _ => EventsOwner::Local,
        };
        let group = map.get("group").and_then(Value::as_object).map(|g| GroupRef {
            id: g.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
            name: g.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
        });
        Ok(CloudDiscovery {
            availability,
            gateway_url,
            mode: GroupMode::from_discovery(string("mode").as_deref()),
            events_owner,
            group,
            producer: string("producer"),
        })
    }
}

/// The VM's live state, from the gateway's `GET /v1/me`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct VmStatus {
    /// `none`, `asleep`, `waking`, `running`, or `unknown` for anything else
    /// (an older gateway sends no `vm` at all).
    pub state: String,
    pub signed_in: Option<bool>,
}

impl VmStatus {
    pub fn parse(text: &str) -> Self {
        let vm = serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("vm").cloned());
        let state = vm
            .as_ref()
            .and_then(|vm| vm.get("state"))
            .and_then(Value::as_str)
            .filter(|s| matches!(*s, "none" | "asleep" | "waking" | "running"))
            .unwrap_or("unknown")
            .to_string();
        let signed_in = vm.as_ref().and_then(|vm| vm.get("signed_in")).and_then(Value::as_bool);
        VmStatus { state, signed_in }
    }
}

/// Why a call to igni server or the gateway did not give an answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DiscoveryError {
    /// Nobody is signed in on this computer.
    NoSession,
    /// igni server's address is not configured.
    NoServer,
    /// 401: the desktop's session expired or was revoked.
    Unauthorized,
    /// 403, with the reason the answer named (`group_local_only`, …).
    Forbidden(String),
    /// 409 `mode_forbids`: the group's mode does not allow that owner.
    ModeForbids,
    /// 404: an igni server older than the switch.
    NotSupported,
    /// Any other status.
    Status(u16),
    /// DNS, TCP, TLS or a timeout.
    Network(String),
    /// A body that is not the contract's.
    BadAnswer,
}

impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiscoveryError::NoSession => f.write_str("You are not signed in on this computer."),
            DiscoveryError::NoServer => f.write_str("igni server's address is not set on this computer."),
            DiscoveryError::Unauthorized => f.write_str("Your sign-in on this computer has expired. Sign in again."),
            DiscoveryError::Forbidden(reason) => write!(f, "igni server refused the cloud: {reason}."),
            DiscoveryError::ModeForbids => f.write_str("Your organisation does not allow that here."),
            DiscoveryError::NotSupported => f.write_str("Your igni server does not offer a cloud igni yet."),
            DiscoveryError::Status(code) => write!(f, "igni server answered {code}."),
            DiscoveryError::Network(why) => write!(f, "Can't reach igni server ({why})."),
            DiscoveryError::BadAnswer => f.write_str("igni server's answer could not be read."),
        }
    }
}

/// The reason a refusal names: `{"error": "…"}` or `{"reason": "…"}`.
fn reason_in(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("reason")
                .or_else(|| v.get("error"))
                .or_else(|| v.get("detail"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn from_ureq(error: ureq::Error) -> DiscoveryError {
    match error {
        ureq::Error::Status(status, response) => {
            let body = response.into_string().unwrap_or_default();
            match status {
                401 => DiscoveryError::Unauthorized,
                403 => DiscoveryError::Forbidden(reason_in(&body)),
                404 => DiscoveryError::NotSupported,
                409 if reason_in(&body) == "mode_forbids" => DiscoveryError::ModeForbids,
                other => DiscoveryError::Status(other),
            }
        }
        ureq::Error::Transport(t) => {
            // A refused certificate must not read like a server that is
            // down: say it, and what to do when it is a company CA's.
            let chain = CauseChain::new(&t, CauseChain::IGNI_SERVER);
            if chain.tls_error().is_some() {
                DiscoveryError::Network(chain.to_string())
            } else {
                DiscoveryError::Network(t.kind().to_string())
            }
        }
    }
}

/// The calls, against one igni server.
pub(crate) struct DiscoveryClient {
    api_url: String,
}

impl DiscoveryClient {
    pub fn new(api_url: &str) -> Self {
        DiscoveryClient {
            api_url: api_url.trim().trim_end_matches('/').to_string(),
        }
    }

    fn agent_for(url: &str) -> Result<ureq::Agent, DiscoveryError> {
        let parsed = tauri::Url::parse(url).ok();
        let host = parsed.as_ref().and_then(|u| u.host_str()).unwrap_or("").to_string();
        let tls = parsed.as_ref().map(|u| u.scheme() == "https").unwrap_or(true);
        Self::agent(&host, tls)
    }

    /// The platform-TLS agent, or why there is none.
    fn agent(host: &str, tls: bool) -> Result<ureq::Agent, DiscoveryError> {
        net::http_agent(host, tls)
            .map_err(|e| DiscoveryError::Network(format!("the system's certificate roots are unavailable: {e}")))
    }

    /// `GET /v1/me/cloud`.
    pub fn cloud(&self, session: &Session) -> Result<CloudDiscovery, DiscoveryError> {
        let url = format!("{}/v1/me/cloud", self.api_url);
        let response = Self::agent_for(&url)?
            .get(&url)
            .set("Authorization", &session.token.bearer())
            .set("Accept", "application/json")
            .call()
            .map_err(from_ureq)?;
        CloudDiscovery::parse(&response.into_string().map_err(|_| DiscoveryError::BadAnswer)?)
    }

    /// `PUT /v1/me/cloud/events-owner {owner}`; answers like `GET`.
    pub fn set_events_owner(&self, session: &Session, owner: EventsOwner) -> Result<CloudDiscovery, DiscoveryError> {
        let url = format!("{}/v1/me/cloud/events-owner", self.api_url);
        let response = Self::agent_for(&url)?
            .put(&url)
            .set("Authorization", &session.token.bearer())
            .set("Content-Type", "application/json")
            .send_string(&serde_json::json!({ "owner": owner.as_str() }).to_string())
            .map_err(from_ureq)?;
        CloudDiscovery::parse(&response.into_string().map_err(|_| DiscoveryError::BadAnswer)?)
    }

    /// The gateway's `GET /v1/me`. Never wakes the VM.
    pub fn vm_status(gateway: &GatewayUrl, session: &Session) -> Result<VmStatus, DiscoveryError> {
        let url = gateway.http("/v1/me");
        let response = Self::agent(gateway.host(), gateway.tls())?
            .get(&url)
            .set("Authorization", &session.token.bearer())
            .call()
            .map_err(from_ureq)?;
        Ok(VmStatus::parse(&response.into_string().unwrap_or_default()))
    }

    /// The gateway's `POST /v1/sign-in`: igni in the VM is handed the
    /// session to exchange for its credential again.
    pub fn vm_sign_in(gateway: &GatewayUrl, session: &Session) -> Result<(), DiscoveryError> {
        let url = gateway.http("/v1/sign-in");
        Self::agent(gateway.host(), gateway.tls())?
            .post(&url)
            .set("Authorization", &session.token.bearer())
            .call()
            .map_err(from_ureq)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::session::tests::credentials;
    use super::super::testing::FakeHttp;
    use super::*;

    #[test]
    fn a_refused_certificate_reads_as_one_not_as_a_server_that_is_down() {
        let mirror = crate::tls_testing::TestMirror::start("{}");
        let url = mirror.url("/v1/me/cloud");
        let err = from_ureq(DiscoveryClient::agent("127.0.0.1", true).unwrap().get(&url).call().unwrap_err());
        let text = err.to_string();
        assert!(text.starts_with("Can't reach igni server ("), "{text}");
        assert!(text.contains("invalid peer certificate"), "{text}");
        #[cfg(not(target_os = "macos"))]
        assert!(text.contains(CauseChain::IGNI_SERVER), "{text}");
    }

    #[test]
    fn a_server_that_is_down_still_reads_as_the_kind_alone() {
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let url = format!("https://127.0.0.1:{port}/v1/me/cloud");
        let err = from_ureq(DiscoveryClient::agent("127.0.0.1", true).unwrap().get(&url).call().unwrap_err());
        assert!(matches!(&err, DiscoveryError::Network(why) if why == "Connection Failed"), "{err:?}");
    }

    fn session() -> Session {
        Session::from_text(&credentials("https://igni.example", "o1", "p1", "SECRETSIG")).unwrap()
    }

    const AVAILABLE: &str = r#"{"cloud":"available","reason":null,"gateway_url":"https://fleet.acme.example",
        "mode":"local_and_cloud","events_owner":"local","group":{"id":"g1","name":"Engineering"},
        "producer":"person:p1","future_field":{"x":1}}"#;

    #[test]
    fn an_available_answer_is_read_and_unknown_fields_ignored() {
        let d = CloudDiscovery::parse(AVAILABLE).unwrap();
        assert_eq!(d.availability, CloudAvailability::Available);
        assert_eq!(d.gateway_url.as_deref(), Some("https://fleet.acme.example"));
        assert_eq!(d.mode, GroupMode::LocalAndCloud);
        assert_eq!(d.events_owner, EventsOwner::Local);
        assert_eq!(d.group, Some(GroupRef { id: "g1".into(), name: "Engineering".into() }));
        assert_eq!(d.producer.as_deref(), Some("person:p1"));
    }

    #[test]
    fn unknown_values_read_in_the_safe_direction() {
        let d = CloudDiscovery::parse(r#"{"cloud":"maybe","reason":"new_reason","gateway_url":"https://g","mode":"sideways","events_owner":"both"}"#).unwrap();
        assert_eq!(d.availability, CloudAvailability::Unavailable("new_reason".into()));
        assert_eq!(d.mode, GroupMode::Local);
        assert_eq!(d.events_owner, EventsOwner::Local);
        let no_reason = CloudDiscovery::parse(r#"{"cloud":"unavailable"}"#).unwrap();
        assert_eq!(no_reason.availability, CloudAvailability::Unavailable("unavailable".into()));
    }

    #[test]
    fn available_without_a_gateway_is_not_available() {
        let d = CloudDiscovery::parse(r#"{"cloud":"available","gateway_url":null,"mode":"cloud"}"#).unwrap();
        assert_eq!(d.availability, CloudAvailability::Unavailable("fleet_not_configured".into()));
    }

    #[test]
    fn a_body_that_is_not_an_object_is_refused() {
        assert_eq!(CloudDiscovery::parse("[]").unwrap_err(), DiscoveryError::BadAnswer);
        assert_eq!(CloudDiscovery::parse("<html>").unwrap_err(), DiscoveryError::BadAnswer);
    }

    #[test]
    fn the_vm_state_is_read_and_anything_else_is_unknown() {
        let s = VmStatus::parse(r#"{"producer":"p","vm":{"state":"asleep","signed_in":true}}"#);
        assert_eq!(s, VmStatus { state: "asleep".into(), signed_in: Some(true) });
        assert_eq!(VmStatus::parse(r#"{"vm":{"state":"melting"}}"#).state, "unknown");
        assert_eq!(VmStatus::parse(r#"{"producer":"p"}"#), VmStatus { state: "unknown".into(), signed_in: None });
    }

    #[test]
    fn the_cloud_call_sends_the_bearer_and_reads_the_answer() {
        let server = FakeHttp::start(vec![(200, AVAILABLE.to_string())]);
        let d = DiscoveryClient::new(&format!("{}/", server.url())).cloud(&session()).unwrap();
        assert_eq!(d.availability, CloudAvailability::Available);
        let request = server.requests().remove(0);
        assert!(request.starts_with("GET /v1/me/cloud "), "{request}");
        assert!(request.to_ascii_lowercase().contains("authorization: bearer h."), "{request}");
        assert!(request.contains("SECRETSIG"), "the token goes to igni server");
    }

    #[test]
    fn the_events_owner_put_carries_the_owner() {
        let server = FakeHttp::start(vec![(200, AVAILABLE.replace("\"events_owner\":\"local\"", "\"events_owner\":\"cloud\""))]);
        let d = DiscoveryClient::new(&server.url()).set_events_owner(&session(), EventsOwner::Cloud).unwrap();
        assert_eq!(d.events_owner, EventsOwner::Cloud);
        let request = server.requests().remove(0);
        assert!(request.starts_with("PUT /v1/me/cloud/events-owner "), "{request}");
        assert!(request.ends_with("{\"owner\":\"cloud\"}"), "{request}");
    }

    #[test]
    fn refusals_are_told_apart() {
        let cases = vec![
            (401, "{}".to_string(), DiscoveryError::Unauthorized),
            (403, r#"{"error":"forbidden","reason":"group_local_only"}"#.to_string(), DiscoveryError::Forbidden("group_local_only".into())),
            (409, r#"{"error":"mode_forbids"}"#.to_string(), DiscoveryError::ModeForbids),
            (409, r#"{"error":"something_else"}"#.to_string(), DiscoveryError::Status(409)),
            (404, "{}".to_string(), DiscoveryError::NotSupported),
            (500, "{}".to_string(), DiscoveryError::Status(500)),
        ];
        for (status, body, expected) in cases {
            let server = FakeHttp::start(vec![(status, body)]);
            let err = DiscoveryClient::new(&server.url()).set_events_owner(&session(), EventsOwner::Local).unwrap_err();
            assert_eq!(err, expected, "status {status}");
        }
    }

    #[test]
    fn an_unreachable_server_is_a_network_error() {
        let port = FakeHttp::dead_port();
        let err = DiscoveryClient::new(&format!("http://127.0.0.1:{port}")).cloud(&session()).unwrap_err();
        assert!(matches!(err, DiscoveryError::Network(_)), "{err:?}");
    }

    #[test]
    fn the_gateway_routes_carry_the_bearer() {
        let server = FakeHttp::start(vec![
            (200, r#"{"vm":{"state":"running","signed_in":false}}"#.to_string()),
            (200, "{}".to_string()),
            (403, r#"{"reason":"group_local_only"}"#.to_string()),
        ]);
        let gw = GatewayUrl::parse(&server.url(), true).unwrap();
        assert_eq!(DiscoveryClient::vm_status(&gw, &session()).unwrap().state, "running");
        DiscoveryClient::vm_sign_in(&gw, &session()).unwrap();
        assert_eq!(
            DiscoveryClient::vm_sign_in(&gw, &session()).unwrap_err(),
            DiscoveryError::Forbidden("group_local_only".into())
        );
        let requests = server.requests();
        assert!(requests[0].starts_with("GET /v1/me "));
        assert!(requests[1].starts_with("POST /v1/sign-in "));
        assert!(requests.iter().all(|r| r.to_ascii_lowercase().contains("authorization: bearer ")));
    }

    /// The contract igni-sdk owns (`contracts/cloud-discovery.schema.json`),
    /// as a fixture copy.
    const SCHEMA: &str = include_str!("../../tests/fixtures/cloud-discovery.schema.json");

    fn schema() -> Value {
        serde_json::from_str(SCHEMA).expect("the fixture is JSON")
    }

    fn enum_of(schema: &Value, def: &str) -> Vec<String> {
        let node = &schema["$defs"][def];
        let values = node.get("enum").cloned().or_else(|| {
            node["oneOf"].as_array()?.iter().find_map(|branch| branch.get("enum").cloned())
        });
        values
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    }

    #[test]
    fn every_example_in_the_contract_reads_as_it_should() {
        let schema = schema();
        let examples = schema["$defs"]["CloudDiscovery"]["examples"].as_array().unwrap().clone();
        assert!(examples.len() >= 6);
        for example in examples {
            let d = CloudDiscovery::parse(&example.to_string()).unwrap();
            let cloud = example["cloud"].as_str().unwrap();
            match cloud {
                "available" => assert_eq!(d.availability, CloudAvailability::Available, "{example}"),
                _ => assert_eq!(d.availability, CloudAvailability::Unavailable(example["reason"].as_str().unwrap().into()), "{example}"),
            }
            assert_eq!(d.mode.as_str(), example["mode"].as_str().unwrap());
            assert_eq!(d.events_owner.as_str(), example["events_owner"].as_str().unwrap());
            assert_eq!(d.gateway_url.as_deref(), example["gateway_url"].as_str());
            assert_eq!(d.group.is_some(), !example["group"].is_null(), "group may be null");
            assert_eq!(d.producer.as_deref(), example["producer"].as_str());
        }
    }

    #[test]
    fn the_contracts_enums_are_the_ones_this_reader_knows() {
        let schema = schema();
        assert_eq!(enum_of(&schema, "Cloud"), vec!["available", "unavailable"]);
        assert_eq!(enum_of(&schema, "Mode"), vec!["local", "cloud", "local_and_cloud"]);
        assert_eq!(enum_of(&schema, "EventsOwner"), vec!["local", "cloud"]);
        assert_eq!(enum_of(&schema, "Reason"), vec!["fleet_not_configured", "group_local_only", "inactive", "not_licensed"]);
        for mode in enum_of(&schema, "Mode") {
            assert_eq!(GroupMode::from_discovery(Some(&mode)).as_str(), mode);
        }
        let required: Vec<&str> = schema["$defs"]["CloudDiscovery"]["required"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        for field in ["cloud", "reason", "gateway_url", "mode", "events_owner", "group", "producer"] {
            assert!(required.contains(&field), "{field}");
        }
        assert_eq!(schema["$defs"]["ModeForbids"]["properties"]["error"]["const"], "mode_forbids");
        assert_eq!(schema["$defs"]["EventsOwnerRequest"]["required"], serde_json::json!(["owner"]));
    }

    #[test]
    fn the_fixture_is_the_sdks_contract_when_a_checkout_is_beside_this_one() {
        // `../igni-sdk` beside this repository, as the Makefile expects; a
        // checkout without it skips, and CI checks out igni-sdk there.
        let sdk = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .map(|root| root.join("../igni-sdk/contracts/cloud-discovery.schema.json"));
        match sdk.and_then(|p| std::fs::read_to_string(p).ok()) {
            Some(theirs) if theirs.contains("cloud-discovery") => assert_eq!(
                serde_json::from_str::<Value>(&theirs).unwrap(),
                schema(),
                "tests/fixtures/cloud-discovery.schema.json is behind igni-sdk's contract; copy it again"
            ),
            _ => eprintln!("no igni-sdk checkout with the discovery contract beside this one; fixture not compared"),
        }
    }

    #[test]
    fn the_person_facing_texts_name_what_to_do() {
        assert_eq!(DiscoveryError::Unauthorized.to_string(), "Your sign-in on this computer has expired. Sign in again.");
        assert_eq!(DiscoveryError::ModeForbids.to_string(), "Your organisation does not allow that here.");
        assert_eq!(DiscoveryError::Network("dns".into()).to_string(), "Can't reach igni server (dns).");
        assert!(!DiscoveryError::Forbidden("inactive".into()).to_string().is_empty());
    }
}
