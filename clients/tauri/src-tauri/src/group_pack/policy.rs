//! The policy a pack carries, and the settings it contributes.

use serde::Deserialize;
use serde_json::{Map, Value};

use super::lenient;

/// The backend's `GroupPolicyPack`, as much of it as the shell reads.
#[derive(Debug, Default, Clone, Deserialize)]
pub(crate) struct GroupPolicy {
    #[serde(default, deserialize_with = "lenient::list")]
    pub entries: Vec<PolicyEntry>,
}

/// One entry of a pack. Every field is read leniently: a field of the wrong
/// type counts as absent, so one odd entry never costs the rest of the pack.
#[derive(Debug, Default, Clone, Deserialize)]
pub(crate) struct PolicyEntry {
    #[serde(default, deserialize_with = "lenient::field")]
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "lenient::field")]
    pub content_type: Option<String>,
    #[serde(default, deserialize_with = "lenient::field")]
    pub enabled: Option<bool>,
    #[serde(default, deserialize_with = "lenient::field")]
    pub content: Option<String>,
}

impl PolicyEntry {
    /// The settings object this entry contributes: an enabled JSON
    /// `settings` entry whose content parses as an object.
    fn settings(&self) -> Option<Map<String, Value>> {
        if self.kind.as_deref() != Some("settings") || self.content_type.as_deref() != Some("json") {
            return None;
        }
        if self.enabled == Some(false) {
            return None;
        }
        match serde_json::from_str(self.content.as_deref()?) {
            Ok(Value::Object(parsed)) => Some(parsed),
            _ => None,
        }
    }
}

impl GroupPolicy {
    /// The enabled JSON `settings` entries, merged — what the backend's
    /// `GroupPolicyPack.to_settings_dict` produces — as JSON text.
    pub(crate) fn settings_json(&self) -> String {
        let mut merged = Map::new();
        for parsed in self.entries.iter().filter_map(PolicyEntry::settings) {
            deep_merge(&mut merged, parsed);
        }
        Value::Object(merged).to_string()
    }
}

fn deep_merge(base: &mut Map<String, Value>, over: Map<String, Value>) {
    for (key, value) in over {
        match (base.get_mut(&key), value) {
            (Some(Value::Object(existing)), Value::Object(incoming)) => deep_merge(existing, incoming),
            (_, value) => {
                base.insert(key, value);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(content: &str, enabled: Option<bool>) -> PolicyEntry {
        PolicyEntry {
            kind: Some("settings".into()),
            content_type: Some("json".into()),
            enabled,
            content: Some(content.into()),
        }
    }

    #[test]
    fn enabled_json_settings_entries_merge_deeply() {
        let policy = GroupPolicy {
            entries: vec![
                entry("{\"a\": {\"x\": 1}, \"b\": 1}", None),
                entry("{\"a\": {\"y\": 2}}", Some(true)),
                entry("{\"b\": 9}", Some(false)),
                entry("not json", None),
                PolicyEntry { kind: Some("prompt".into()), ..entry("{\"b\": 8}", None) },
            ],
        };
        let merged: Value = serde_json::from_str(&policy.settings_json()).unwrap();
        assert_eq!(merged, serde_json::json!({"a": {"x": 1, "y": 2}, "b": 1}));
    }

    #[test]
    fn a_malformed_entry_costs_only_itself() {
        let policy: GroupPolicy = serde_json::from_value(serde_json::json!({"entries": [
            {"kind": "prompt", "content_type": "markdown", "content": {"not": "a string"}},
            {"kind": 7, "enabled": "yes"},
            "not an object",
            {"kind": "settings", "content_type": "json", "enabled": "no", "content": "{\"air_gapped\": true}"},
        ]}))
        .expect("parses");
        let merged: Value = serde_json::from_str(&policy.settings_json()).unwrap();
        assert_eq!(merged, serde_json::json!({"air_gapped": true}));
        let odd: GroupPolicy = serde_json::from_value(serde_json::json!({"entries": {"x": 1}})).expect("parses");
        assert!(odd.entries.is_empty(), "entries that are not an array are none");
    }
}
