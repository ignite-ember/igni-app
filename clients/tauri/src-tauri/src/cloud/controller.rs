//! The shell's owner of the cloud side: it holds the switchboard, starts
//! the relay, runs the effects the switchboard asks for, watches
//! `credentials.json`, the pack and igni server, and tells every window
//! (§4.2: "the shell is the single source of truth for which side is
//! active").
//!
//! Everything that touches Tauri goes through [`ShellPort`], so the
//! controller runs under test with a fake shell, a stand-in igni server
//! and a stand-in gateway.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::account;
use super::choice::ChoiceStore;
use super::discovery::{DiscoveryClient, DiscoveryError, EventsOwner};
use super::gateway::GatewayUrl;
use super::log;
use super::net::CloudHttp;
use super::pages::PageOrigins;
use super::relay::dial::DialError;
use super::relay::{Relay, RelayEvent, RelayHooks};
use super::session::{credentials_fingerprint, Session};
use super::state::{BackendState, Side, Unreachable};
use super::switchboard::{Account, BackendSnapshot, Effect, Switchboard, WindowActivity, WindowTarget};
use crate::backend::{cloud_app_url, BackendConn};
use crate::desktop_settings::CloudSettings;

/// How often igni server is asked again while the app is focused.
#[cfg_attr(test, allow(dead_code))]
const DISCOVERY_EVERY: Duration = Duration::from_secs(5 * 60);
/// How often the watcher looks at `credentials.json` and the pack.
#[cfg_attr(test, allow(dead_code))]
const WATCH_EVERY: Duration = Duration::from_secs(1);
/// How often the pack is re-verified for a mode change.
#[cfg_attr(test, allow(dead_code))]
const PACK_EVERY: Duration = Duration::from_secs(5);
/// How often the local runs the badge counts are asked after.
#[cfg_attr(test, allow(dead_code))]
const ACTIVITY_EVERY: Duration = Duration::from_secs(10);
/// How long a launch waits for igni server before deciding the side.
const LAUNCH_DISCOVERY_WAIT: Duration = Duration::from_secs(5);

/// What the controller needs of the app around it.
pub(crate) trait ShellPort: Send + Sync + 'static {
    fn broadcast(&self, snapshot: &BackendSnapshot);
    /// Point every app window at `target`. `cloud_url` is the relay's
    /// window URL, for [`WindowTarget::Relay`].
    fn point_windows(&self, target: WindowTarget, cloud_url: &str);
    fn spawn_full_backend(&self) -> Result<(), String>;
    fn use_account_only_backend(&self) -> Result<(), String>;
    fn label_menu(&self, side: Side);
    /// This computer's backend, full or account-only.
    fn local_conn(&self) -> Option<BackendConn>;
    #[cfg_attr(test, allow(dead_code))]
    fn focused(&self) -> bool;
    /// Stop every extension page origin (§15.4).
    fn stop_page_origins(&self) {}
}

struct Inner {
    home: PathBuf,
    /// A debug build's `IGNI_DEV_GATEWAY_INSECURE=1`.
    allow_insecure: bool,
    choices: ChoiceStore,
    settings: Mutex<CloudSettings>,
    board: Mutex<Switchboard>,
    relay: OnceLock<Relay>,
    /// The extension page origins of the cloud side (§15.4), beside the
    /// relay and stopped with it.
    pages: OnceLock<PageOrigins>,
    shell: Arc<dyn ShellPort>,
    effects: Mutex<Option<mpsc::Sender<Vec<Effect>>>>,
    launched: std::sync::atomic::AtomicBool,
}

/// Managed in `setup`; cheap to clone.
#[derive(Clone)]
pub(crate) struct CloudController {
    inner: Arc<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn account_of(session: &Session) -> Account {
    Account { key: session.account_key(), org: session.org.clone(), sub: session.sub.clone() }
}

/// The relay's view of the controller: the target is read on every dial.
struct Hooks(std::sync::Weak<Inner>);

impl RelayHooks for Hooks {
    fn target(&self) -> Result<(GatewayUrl, Session), DialError> {
        let inner = self.0.upgrade().ok_or_else(|| DialError::Unreachable(Unreachable::Gateway("shutting down".into())))?;
        let session = Session::read(&inner.home).ok_or(DialError::Unauthorized)?;
        let gateway = lock(&inner.board)
            .gateway
            .clone()
            .ok_or_else(|| DialError::Unreachable(Unreachable::Gateway("igni server has not named a gateway yet".into())))?;
        Ok((gateway, session))
    }

    fn event(&self, event: RelayEvent) {
        if let Some(inner) = self.0.upgrade() {
            CloudController { inner }.apply(|board| board.relay(event));
        }
    }
}

impl CloudController {
    /// A controller for `home`, keeping its choices in `state_dir`.
    pub fn new(home: PathBuf, state_dir: PathBuf, settings: CloudSettings, shell: Arc<dyn ShellPort>, allow_insecure: bool) -> Self {
        let session = Session::read(&home);
        let account = session.as_ref().map(account_of);
        let choices = ChoiceStore::in_dir(&state_dir);
        let remembered = account.as_ref().and_then(|a| choices.get(&a.key)).map(|r| (r.side, r.gateway_url));
        let board = Switchboard::launch(
            settings.pack_mode,
            account,
            remembered,
            allow_insecure,
            settings.gateway_pin.clone(),
        );
        CloudController {
            inner: Arc::new(Inner {
                home,
                allow_insecure,
                choices,
                settings: Mutex::new(settings),
                board: Mutex::new(board),
                relay: OnceLock::new(),
                pages: OnceLock::new(),
                shell,
                effects: Mutex::new(None),
                launched: std::sync::atomic::AtomicBool::new(false),
            }),
        }
    }

    /// Start the relay and the effect runner. Called once, from inside
    /// the async runtime.
    pub async fn start(&self) -> std::io::Result<()> {
        if self.inner.relay.get().is_some() {
            return Ok(());
        }
        let http = CloudHttp::from_env().map_err(|e| std::io::Error::other(e.to_string()))?;
        self.start_with(http).await
    }

    pub async fn start_with(&self, http: CloudHttp) -> std::io::Result<()> {
        if self.inner.relay.get().is_some() {
            return Ok(());
        }
        let hooks: Arc<dyn RelayHooks> = Arc::new(Hooks(Arc::downgrade(&self.inner)));
        let relay = Relay::start(hooks.clone(), http.clone()).await?;
        let _ = self.inner.relay.set(relay);
        let _ = self.inner.pages.set(PageOrigins::new(hooks, http));
        let (tx, rx) = mpsc::channel::<Vec<Effect>>();
        *lock(&self.inner.effects) = Some(tx);
        let runner = self.clone();
        std::thread::spawn(move || {
            while let Ok(batch) = rx.recv() {
                for effect in batch {
                    runner.run(effect);
                }
            }
        });
        Ok(())
    }

    /// Whether `cloud` mode applies at launch: the shell then starts the
    /// account-only backend and never the full one.
    pub fn starts_in_cloud_mode(&self) -> bool {
        !lock(&self.inner.board).full_backend
    }

    /// Decide the launch side: igni server is asked first (for a bounded
    /// wait) when the account last chose the cloud or the group runs in
    /// it, so the first window opens on the right side.
    pub fn launch(&self) {
        if self.inner.launched.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let (ask, side) = {
            let board = lock(&self.inner.board);
            (board.want_cloud || board.side == Side::Cloud || board.account.is_some(), board.side)
        };
        if ask {
            let me = self.clone();
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(me.discover());
            });
            if let Ok((answer, vm)) = rx.recv_timeout(LAUNCH_DISCOVERY_WAIT) {
                let mut board = lock(&self.inner.board);
                board.discovered(answer, Instant::now());
                if board.side == Side::Cloud {
                    board.vm_status(vm);
                }
            } else {
                log::line("cloud", "igni server did not answer in time; deciding the side without it");
            }
        }
        let now_side = lock(&self.inner.board).side;
        if now_side != side || now_side == Side::Cloud {
            self.inner.shell.label_menu(now_side);
        }
        self.inner.launched.store(true, std::sync::atomic::Ordering::SeqCst);
        self.broadcast();
        #[cfg(not(test))]
        self.watch();
    }

    /// The URL a window goes to for the current target; `dir` is a New
    /// Window's folder (dropped on the cloud, which has its own workspace).
    pub fn window_url(&self, dir: Option<&str>) -> Option<String> {
        match self.target() {
            WindowTarget::Relay => Some(self.cloud_url()),
            WindowTarget::Local | WindowTarget::SignIn => self.inner.shell.local_conn().map(|c| c.app_url(dir)),
        }
    }

    pub fn target(&self) -> WindowTarget {
        lock(&self.inner.board).target()
    }

    fn cloud_url(&self) -> String {
        let key = lock(&self.inner.board).backend_key();
        match self.inner.relay.get() {
            Some(relay) => cloud_app_url(relay.port(), relay.token(), &key),
            None => String::new(),
        }
    }

    pub fn snapshot(&self) -> BackendSnapshot {
        let mut snapshot = lock(&self.inner.board).snapshot();
        if snapshot.state == "cloud_unreachable" {
            snapshot.retry_in_ms = self.inner.relay.get().and_then(Relay::retry_in).map(|d| d.as_millis() as u64);
        }
        snapshot
    }

    fn broadcast(&self) {
        self.inner.shell.broadcast(&self.snapshot());
    }

    /// Change the board, tell every window, run what it asked for.
    pub(crate) fn apply(&self, change: impl FnOnce(&mut Switchboard) -> Vec<Effect>) {
        let effects = change(&mut lock(&self.inner.board));
        self.broadcast();
        if effects.is_empty() {
            return;
        }
        match lock(&self.inner.effects).as_ref() {
            Some(tx) => {
                let _ = tx.send(effects);
            }
            None => {
                for effect in effects {
                    self.run(effect);
                }
            }
        }
    }

    // ── Commands ──────────────────────────────────────────────────

    /// The person flipped the switch. A cloud switch asks igni server
    /// first and sets the events owner before any window moves (§4.1).
    pub fn switch(&self, side: Side) -> Result<(), String> {
        lock(&self.inner.board).may_switch(side)?;
        if side == Side::Cloud {
            let (answer, vm) = self.discover();
            let failed = answer.as_ref().err().cloned();
            self.apply(|board| {
                board.vm_status(vm);
                board.discovered(answer, Instant::now())
            });
            if let Some(error) = failed {
                return Err(error.to_string());
            }
            lock(&self.inner.board).may_switch(Side::Cloud)?;
            let (client, session) = self.server()?;
            let owner = client.set_events_owner(&session, EventsOwner::Cloud).map_err(|e| e.to_string())?;
            self.apply(|board| {
                let mut effects = board.discovered(Ok(owner), Instant::now());
                if board.may_switch(Side::Cloud).is_ok() {
                    effects.extend(board.switch(Side::Cloud));
                }
                effects
            });
            return Ok(());
        }
        self.apply(|board| board.switch(Side::Local));
        Ok(())
    }

    /// **Sign in** on the needs-sign-in banner: the gateway hands igni in
    /// the VM the desktop's session again. The banner clears when igni
    /// pushes `ready`.
    pub fn cloud_sign_in(&self) -> Result<(), String> {
        let session = Session::read(&self.inner.home).ok_or_else(|| DiscoveryError::NoSession.to_string())?;
        let gateway = lock(&self.inner.board).gateway.clone().ok_or("igni server has not named your cloud's gateway yet.")?;
        DiscoveryClient::vm_sign_in(&gateway, &session).map_err(|e| match e {
            DiscoveryError::Unauthorized => {
                self.apply(|board| board.relay(RelayEvent::DialFailed { error: DialError::Unauthorized, retry_in: Duration::ZERO }));
                e.to_string()
            }
            other => other.to_string(),
        })
    }

    pub fn retry(&self) {
        self.apply(|board| board.retry());
    }

    pub fn dismiss(&self) {
        self.apply(|board| {
            board.dismiss();
            Vec::new()
        });
    }

    pub fn report_activity(&self, label: &str, report: WindowActivity) {
        self.apply(|board| board.activity(label, report, Instant::now()));
    }

    /// `cloud_page_origin`: the loopback origin serving `extension_id`'s
    /// page while the app is on the cloud (§15.4). Refused for a bad id,
    /// off the cloud side, or when the listener cannot bind. Never takes
    /// or returns a token.
    pub async fn page_origin(&self, extension_id: &str) -> Result<String, String> {
        if !super::pages::extension_id_ok(extension_id) {
            return Err(format!("{extension_id:?} is not an extension id"));
        }
        let serving = {
            let board = lock(&self.inner.board);
            board.side == Side::Cloud
                && matches!(
                    board.state,
                    BackendState::Dialing
                        | BackendState::Waking
                        | BackendState::CloudReady { .. }
                        | BackendState::CloudNeedsSignIn
                        | BackendState::CloudUnreachable(_)
                )
        };
        if !serving {
            return Err("not in cloud mode".into());
        }
        let pages = self.inner.pages.get().ok_or("not in cloud mode")?;
        let port = pages.start_for(extension_id).await?;
        Ok(format!("http://127.0.0.1:{port}"))
    }

    /// One allow-listed account call on this computer's backend.
    pub async fn account_rpc(&self, method: &str, args: Value) -> Result<Value, String> {
        if !account::allowed(method) {
            return Err(format!("{method} is not an account call"));
        }
        let conn = self.inner.shell.local_conn().ok_or("this computer's backend is still starting")?;
        account::call(&conn, method, args).await
    }

    // ── Watching ──────────────────────────────────────────────────

    /// The background loop: credentials, the pack, igni server, the
    /// waiting move to the cloud, the badge's local runs.
    #[cfg_attr(test, allow(dead_code))]
    pub fn watch(&self) {
        let me = self.clone();
        std::thread::spawn(move || {
            let mut fingerprint = credentials_fingerprint(&me.inner.home);
            let mut last_pack = Instant::now();
            let mut last_discovery = Instant::now();
            let mut last_activity = Instant::now();
            loop {
                std::thread::sleep(WATCH_EVERY);
                let now_fp = credentials_fingerprint(&me.inner.home);
                if now_fp != fingerprint {
                    fingerprint = now_fp;
                    me.credentials_changed();
                }
                if last_pack.elapsed() >= PACK_EVERY {
                    last_pack = Instant::now();
                    me.recheck_pack(CloudSettings::load());
                }
                if last_discovery.elapsed() >= DISCOVERY_EVERY && me.inner.shell.focused() {
                    last_discovery = Instant::now();
                    me.recheck_discovery();
                }
                me.apply(|board| board.tick(Instant::now()));
                if last_activity.elapsed() >= ACTIVITY_EVERY {
                    last_activity = Instant::now();
                    me.poll_local_runs();
                }
            }
        });
    }

    /// `credentials.json` changed: who is signed in now.
    pub fn credentials_changed(&self) {
        let session = Session::read(&self.inner.home);
        let account = session.as_ref().map(account_of);
        let remembered = account.as_ref().and_then(|a| self.inner.choices.get(&a.key)).map(|r| r.side);
        self.apply(|board| board.credentials(account, remembered));
    }

    /// The verified pack's mode, read again.
    pub fn recheck_pack(&self, settings: CloudSettings) {
        let mode = settings.pack_mode;
        let changed = {
            let mut current = lock(&self.inner.settings);
            let changed = current.pack_mode != mode;
            *current = settings;
            changed
        };
        if changed {
            log::line("cloud", format!("the group's mode is now {}", mode.as_str()));
            self.apply(|board| board.pack_mode(mode, Instant::now()));
        }
    }

    fn recheck_discovery(&self) {
        let (answer, vm) = self.discover();
        self.apply(|board| {
            if board.side == Side::Cloud {
                board.vm_status(vm);
            }
            board.discovered(answer, Instant::now())
        });
    }

    /// Ask the local backend whether the runs the badge counts are over.
    #[cfg_attr(test, allow(dead_code))]
    fn poll_local_runs(&self) {
        let sessions: Vec<(String, String)> = {
            let board = lock(&self.inner.board);
            if board.side != Side::Cloud {
                return;
            }
            board
                .activity
                .iter()
                .filter(|(_, w)| w.runs > 0 && !w.session_id.is_empty())
                .map(|(label, w)| (label.clone(), w.session_id.clone()))
                .collect()
        };
        if sessions.is_empty() {
            return;
        }
        let Some(conn) = self.inner.shell.local_conn() else { return };
        for (label, session) in sessions {
            let answer = tauri::async_runtime::block_on(account::call_with(&conn, "get_processing", Value::Object(Default::default()), Some(&session)));
            if answer == Ok(Value::Bool(false)) {
                self.apply(|board| {
                    board.local_run_ended(&label);
                    Vec::new()
                });
            }
        }
    }

    fn server(&self) -> Result<(DiscoveryClient, Session), String> {
        let session = Session::read(&self.inner.home).ok_or_else(|| DiscoveryError::NoSession.to_string())?;
        let api_url = lock(&self.inner.settings).api_url.clone().ok_or_else(|| DiscoveryError::NoServer.to_string())?;
        Ok((DiscoveryClient::new(&api_url), session))
    }

    /// `/v1/me/cloud`, and the gateway's `/v1/me` when there is a cloud.
    fn discover(&self) -> (Result<super::discovery::CloudDiscovery, DiscoveryError>, Option<super::discovery::VmStatus>) {
        let session = match Session::read(&self.inner.home) {
            Some(s) => s,
            None => return (Err(DiscoveryError::NoSession), None),
        };
        let Some(api_url) = lock(&self.inner.settings).api_url.clone() else {
            return (Err(DiscoveryError::NoServer), None);
        };
        let answer = DiscoveryClient::new(&api_url).cloud(&session);
        let vm = answer
            .as_ref()
            .ok()
            .and_then(|d| d.gateway_url.as_deref())
            .and_then(|u| GatewayUrl::parse(u, self.inner.allow_insecure).ok())
            .and_then(|gw| DiscoveryClient::vm_status(&gw, &session).ok());
        (answer, vm)
    }

    // ── Effects ───────────────────────────────────────────────────

    fn run(&self, effect: Effect) {
        match effect {
            Effect::PointWindows(target) => {
                if self.inner.launched.load(std::sync::atomic::Ordering::SeqCst) {
                    let url = self.cloud_url();
                    self.inner.shell.point_windows(target, &url);
                }
            }
            Effect::PutEventsOwner(owner) => {
                let me = self.clone();
                std::thread::spawn(move || match me.server() {
                    Ok((client, session)) => match client.set_events_owner(&session, owner) {
                        Ok(_) => {}
                        Err(e) => log::line("cloud", format!("telling igni server the events owner ({}) failed: {e}", owner.as_str())),
                    },
                    Err(e) => log::line("cloud", format!("the events owner was not set: {e}")),
                });
            }
            Effect::Remember(side) => {
                let (account, gateway) = {
                    let board = lock(&self.inner.board);
                    (board.account.clone(), board.gateway.as_ref().map(GatewayUrl::base))
                };
                if let Some(account) = account {
                    if let Err(e) = self.inner.choices.set(&account.key, side, gateway) {
                        log::line("cloud", format!("remembering the side failed: {e}"));
                    }
                }
            }
            Effect::CloseUpstreams(code) => {
                if let Some(relay) = self.inner.relay.get() {
                    relay.close_all(code);
                }
            }
            Effect::RecheckDiscovery => {
                let me = self.clone();
                std::thread::spawn(move || me.recheck_discovery());
            }
            Effect::SpawnFullBackend => {
                if let Err(e) = self.inner.shell.spawn_full_backend() {
                    log::line("cloud", format!("starting this computer's backend failed: {e}"));
                }
            }
            Effect::UseAccountOnlyBackend => {
                if let Err(e) = self.inner.shell.use_account_only_backend() {
                    log::line("cloud", format!("starting the account backend failed: {e}"));
                }
            }
            Effect::RetryNow => {
                if let Some(relay) = self.inner.relay.get() {
                    relay.retry_now();
                }
            }
            Effect::StopPageOrigins => {
                if let Some(pages) = self.inner.pages.get() {
                    pages.stop_all();
                }
                self.inner.shell.stop_page_origins();
            }
            Effect::LabelMenu(side) => self.inner.shell.label_menu(side),
        }
    }

}

#[cfg(test)]
mod tests;
