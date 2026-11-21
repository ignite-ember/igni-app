//! The switches the Windows webview (WebView2) is started with.
//!
//! wry always sets WebView2's `AdditionalBrowserArguments` — its default
//! turns off the mini menu and SmartScreen — and an app that sets them gets
//! no `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` from the environment: the
//! documented way an administrator, a support engineer or a test harness
//! passes WebView2 a switch was ignored. msedgedriver (WebDriver for
//! WebView2) works through exactly that variable, so the app could not be
//! driven at all ("DevToolsActivePort file doesn't exist"), and
//! `--remote-debugging-port` from the environment never opened. Found by
//! the Windows desktop E2E job (docs/ENTERPRISE_TEST_PLAN.md F12).
//!
//! So the app passes wry's defaults *and* whatever the environment asks
//! for, merging the two `--disable-features` lists into one switch, since
//! Chromium honours only one of them.

/// wry's own default, kept: the mini menu, the PDF menu and SmartScreen off.
pub(crate) const DEFAULT_DISABLED_FEATURES: &str = "msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// The variable WebView2 documents for extra switches.
pub(crate) const ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

const DISABLE: &str = "--disable-features=";

/// The switches for WebView2: wry's defaults, then `from_env`'s.
pub(crate) fn browser_args(from_env: Option<&str>) -> String {
    let mut disabled: Vec<String> = DEFAULT_DISABLED_FEATURES.split(',').map(str::to_string).collect();
    let mut rest: Vec<&str> = Vec::new();
    for arg in from_env.unwrap_or("").split_whitespace() {
        match arg.strip_prefix(DISABLE) {
            Some(list) => {
                for feature in list.split(',').filter(|f| !f.is_empty()) {
                    if !disabled.iter().any(|d| d == feature) {
                        disabled.push(feature.to_string());
                    }
                }
            }
            None => rest.push(arg),
        }
    }
    let mut out = format!("{DISABLE}{}", disabled.join(","));
    for arg in rest {
        out.push(' ');
        out.push_str(arg);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_the_variable_it_is_wrys_default() {
        assert_eq!(
            browser_args(None),
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        );
        assert_eq!(browser_args(Some("  ")), browser_args(None));
    }

    #[test]
    fn the_environments_switches_are_passed_on() {
        let args = browser_args(Some("--remote-debugging-port=9222 --enable-logging"));
        assert!(args.contains(" --remote-debugging-port=9222"), "{args}");
        assert!(args.contains(" --enable-logging"), "{args}");
        assert!(args.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
    }

    #[test]
    fn two_disable_features_lists_become_one() {
        // msedgedriver sends its own list; a second switch would replace ours.
        let args = browser_args(Some("--disable-features=IgnoreDuplicateNavs,Prewarm,msWebOOUI --test-type=webdriver"));
        assert_eq!(args.matches("--disable-features=").count(), 1, "{args}");
        assert!(args.starts_with(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IgnoreDuplicateNavs,Prewarm "
        ), "{args}");
        assert!(args.ends_with(" --test-type=webdriver"), "{args}");
    }
}
