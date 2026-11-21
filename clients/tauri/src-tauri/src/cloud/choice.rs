//! The side each account last chose, kept in the shell's own state file
//! and keyed by `iss|org|sub` (§4.1). The next launch starts on that side
//! if it is still allowed, and otherwise on this computer.
//!
//! The gateway address is kept beside it, so a `cloud`-mode desktop that
//! starts offline still knows where its cloud is and can say it is
//! unreachable rather than nothing. It is not a secret; no token is here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::state::Side;

/// What is remembered for one account.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Remembered {
    pub side: Side,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway_url: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct ChoiceFile {
    #[serde(default)]
    accounts: BTreeMap<String, Remembered>,
}

/// The file, read and written whole on each use.
#[derive(Clone, Debug)]
pub(crate) struct ChoiceStore {
    path: PathBuf,
}

impl ChoiceStore {
    pub const FILE: &'static str = "backend-choice.json";

    pub fn in_dir(dir: &Path) -> Self {
        ChoiceStore { path: dir.join(Self::FILE) }
    }

    fn read(&self) -> ChoiceFile {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn get(&self, account: &str) -> Option<Remembered> {
        self.read().accounts.remove(account)
    }

    /// Remember `side` for `account`; a `gateway_url` of `None` keeps the
    /// one already remembered.
    pub fn set(&self, account: &str, side: Side, gateway_url: Option<String>) -> std::io::Result<()> {
        let mut file = self.read();
        let kept = file.accounts.get(account).and_then(|r| r.gateway_url.clone());
        file.accounts.insert(account.to_string(), Remembered { side, gateway_url: gateway_url.or(kept) });
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
        // Written beside, then renamed, so a crash never leaves half a file.
        let partial = self.path.with_extension("json.partial");
        std::fs::write(&partial, text)?;
        std::fs::rename(&partial, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> (ChoiceStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("igni-choice-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (ChoiceStore::in_dir(&dir), dir)
    }

    #[test]
    fn each_account_keeps_its_own_side() {
        let (store, dir) = store("accounts");
        assert_eq!(store.get("i|o|a"), None);
        store.set("i|o|a", Side::Cloud, Some("https://fleet.example".into())).unwrap();
        store.set("i|o|b", Side::Local, None).unwrap();
        assert_eq!(store.get("i|o|a"), Some(Remembered { side: Side::Cloud, gateway_url: Some("https://fleet.example".into()) }));
        assert_eq!(store.get("i|o|b"), Some(Remembered { side: Side::Local, gateway_url: None }));
        // Flipping back keeps the gateway it knew.
        store.set("i|o|a", Side::Local, None).unwrap();
        assert_eq!(store.get("i|o|a").unwrap().gateway_url.as_deref(), Some("https://fleet.example"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_file_remembers_nothing_and_is_replaced() {
        let (store, dir) = store("garbage");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(ChoiceStore::FILE), "not json").unwrap();
        assert_eq!(store.get("x"), None);
        store.set("x", Side::Cloud, None).unwrap();
        assert_eq!(store.get("x").unwrap().side, Side::Cloud);
        assert!(!dir.join("backend-choice.json.partial").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
