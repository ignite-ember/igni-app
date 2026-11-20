//! The desktop's cloud side: discovery, the relay, the switch.
//!
//! The design is igni-core's `docs/design/local-cloud-switch.md` (R691);
//! the section each part implements is named in its module. The shell owns
//! one app-wide choice, *This computer · Cloud*, remembered per account.
//! On the cloud side every window is pointed at a loopback relay in this
//! process, which dials the person's cloud igni through the Fleet gateway
//! with the desktop's session token: the token never enters a webview,
//! and the CSP stays loopback-only.

pub(crate) mod account;
pub(crate) mod choice;
pub(crate) mod commands;
pub(crate) mod controller;
pub(crate) mod discovery;
pub(crate) mod gateway;
pub(crate) mod log;
pub(crate) mod mode;
pub(crate) mod net;
pub(crate) mod relay;
pub(crate) mod session;
pub(crate) mod shell;
pub(crate) mod state;
pub(crate) mod switchboard;

#[cfg(test)]
pub(crate) mod testing;
