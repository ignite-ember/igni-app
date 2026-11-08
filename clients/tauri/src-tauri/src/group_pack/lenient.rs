//! Reading the pack's JSON the way the verifier always has: a field of the
//! wrong type counts as absent, and one odd item in a list never costs the
//! others. A typed struct that failed whole on one bad field would turn a
//! single stray key or entry into no group layer at all.

use serde::de::{DeserializeOwned, Deserializer};
use serde::Deserialize;
use serde_json::Value;

/// The value as a `T`, or `None` when it is some other type.
pub(super) fn field<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

/// The items that read as a `T`; anything but an array is no items.
pub(super) fn list<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    d: D,
) -> Result<Vec<T>, D::Error> {
    let items = match Value::deserialize(d)? {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect())
}
