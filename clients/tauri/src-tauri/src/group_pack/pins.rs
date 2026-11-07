//! The keys an administrator pins: the RFC 7638 thumbprints a pack's
//! signing key must have, when there are any.

use serde_json::Value;

/// The environment variable that pins keys (comma- or space-separated).
pub(crate) const TRUSTED_KEYS_ENV: &str = "IGNI_GROUP_POLICY_TRUSTED_KEYS";

/// Pins from `IGNI_GROUP_POLICY_TRUSTED_KEYS`.
pub(crate) fn pins_from_env(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Pins from a managed-settings file: `group_policy.trusted_keys`, as JSON or
/// as the block YAML an administrator writes (a flow list `[a, b]` or one
/// `- item` per line).
pub(crate) fn pins_from_managed(text: &str) -> Vec<String> {
    if text.trim_start().starts_with('{') {
        // Read item by item, not as a typed struct: one item that is not a
        // string must drop that item, not every pin (no pins verifies any key).
        let Ok(value) = serde_json::from_str::<Value>(text) else { return Vec::new() };
        return value
            .pointer("/group_policy/trusted_keys")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default();
    }
    let clean = |s: &str| s.split('#').next().unwrap_or("").trim().trim_matches('"').trim_matches('\'').to_string();
    let mut lines = text.lines().skip_while(|line| !line.starts_with("group_policy:"));
    if lines.next().is_none() {
        return Vec::new();
    }
    let block: Vec<&str> = lines.take_while(|line| line.trim().is_empty() || line.starts_with(char::is_whitespace)).collect();
    let Some(at) = block.iter().position(|line| line.trim_start().starts_with("trusted_keys:")) else {
        return Vec::new();
    };
    let key_line = block[at];
    let indent = key_line.len() - key_line.trim_start().len();
    let rest = key_line.trim_start()["trusted_keys:".len()..].trim();
    if rest.starts_with('[') {
        return rest
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or("")
            .split(',')
            .map(clean)
            .filter(|s| !s.is_empty())
            .collect();
    }
    block[at + 1..]
        .iter()
        .take_while(|line| line.trim().is_empty() || line.len() - line.trim_start().len() > indent || line.trim_start().starts_with("- "))
        .filter_map(|line| line.trim_start().strip_prefix("- ").map(clean))
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_are_read_from_the_managed_file_and_the_environment() {
        assert_eq!(pins_from_managed("group_policy:\n  trusted_keys: [abc, \"def\"]\n"), vec!["abc", "def"]);
        assert_eq!(pins_from_managed("x: 1\ngroup_policy:\n  required: true\n  trusted_keys:\n    - abc\n    - def # old\nother: 2\n"), vec!["abc", "def"]);
        assert_eq!(pins_from_managed("{\"group_policy\": {\"trusted_keys\": [\"abc\"]}}"), vec!["abc"]);
        assert!(pins_from_managed("{\"other\": 1}").is_empty());
        assert_eq!(pins_from_managed("{\"group_policy\": {\"trusted_keys\": [\"abc\", 1, null]}}"), vec!["abc"], "a bad item drops only itself");
        assert_eq!(pins_from_managed("{\"group_policy\": {}, \"group_policy\": {\"trusted_keys\": [\"abc\"]}}"), vec!["abc"], "a duplicate key keeps the last");
        assert!(pins_from_managed("trusted_keys: [abc]\n").is_empty(), "top-level is not group_policy");
        assert_eq!(pins_from_env(Some("abc, def ghi")), vec!["abc", "def", "ghi"]);
    }
}
