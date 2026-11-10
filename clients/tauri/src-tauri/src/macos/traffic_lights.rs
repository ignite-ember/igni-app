//! Keeping the traffic-light cluster where the FE's header expects it.
//!
//! AppKit re-runs the title-bar layout on WKWebView events (navigation,
//! first paint, React mount) and puts the buttons back at its default.
//! Two techniques hold them in place:
//!
//! * A main-thread `CFRunLoopObserver` on `kCFRunLoopBeforeWaiting`, which
//!   runs after that layout pass in the same runloop turn, so the shell's
//!   write is the last one. A timer would run a turn later and lose.
//! * Resizing the title-bar *container* (the buttons' grandparent), not
//!   the buttons: `NSThemeFrame` reads the container's height to place
//!   the buttons, so it is an input to that layout rather than an output
//!   it overwrites. The same technique as wry's `inset_traffic_lights`
//!   and electron PRs #21781 and #30263.

use std::os::raw::c_void;

use core_foundation_sys::base::{kCFAllocatorDefault, CFIndex, CFOptionFlags};
use core_foundation_sys::runloop::{
    kCFRunLoopBeforeWaiting, kCFRunLoopCommonModes, CFRunLoopActivity, CFRunLoopAddObserver,
    CFRunLoopGetMain, CFRunLoopObserverContext, CFRunLoopObserverCreate, CFRunLoopObserverRef,
};
use objc2::msg_send;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

/// Where the leftmost button's top-left corner sits, measured from the
/// window's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TrafficLights {
    pub x: f64,
    pub y: f64,
}

/// What the observer keeps alive for the process lifetime.
struct Anchor {
    window: WebviewWindow,
    lights: TrafficLights,
}

impl TrafficLights {
    pub const DEFAULT: TrafficLights = TrafficLights { x: 16.0, y: 22.0 };

    /// Each button's x offset from the first (close, miniaturize, zoom).
    const BUTTON_SPACING: [f64; 3] = [0.0, 20.0, 40.0];

    /// `NSWindowStyleMaskFullScreen`.
    const NS_WINDOW_STYLE_MASK_FULLSCREEN: u64 = 1 << 14;

    /// Below half a point a write would only invalidate layout.
    const TOLERANCE: f64 = 0.5;

    /// Re-pin after every layout pass for the window's lifetime. Must be
    /// called on the main thread. The anchor is leaked on purpose: the
    /// observer outlives every scope that could own it.
    pub fn install_observer(&self, window: WebviewWindow) {
        extern "C" fn callback(
            _observer: CFRunLoopObserverRef,
            _activity: CFRunLoopActivity,
            info: *mut c_void,
        ) {
            // SAFETY: `info` is the leaked `Anchor` registered below, never freed.
            let anchor = unsafe { &*(info as *const Anchor) };
            anchor.lights.reposition(&anchor.window);
        }

        let anchor = Box::into_raw(Box::new(Anchor {
            window,
            lights: *self,
        })) as *mut c_void;
        let mut context = CFRunLoopObserverContext {
            version: 0,
            info: anchor,
            retain: None,
            release: None,
            copyDescription: None,
        };
        // SAFETY: plain CoreFoundation calls on the main run loop; the
        // context is copied by `CFRunLoopObserverCreate`.
        unsafe {
            let repeats = 1;
            let observer = CFRunLoopObserverCreate(
                kCFAllocatorDefault,
                kCFRunLoopBeforeWaiting as CFOptionFlags,
                repeats,
                0 as CFIndex,
                callback,
                &mut context,
            );
            if observer.is_null() {
                return;
            }
            let run_loop = CFRunLoopGetMain();
            if run_loop.is_null() {
                return;
            }
            CFRunLoopAddObserver(run_loop, observer, kCFRunLoopCommonModes);
        }
    }

    /// Put the cluster at `(x, y)`. A no-op in native fullscreen, where
    /// AppKit moves the buttons into the slide-down panel, and before the
    /// window is laid out.
    pub fn reposition(&self, window: &WebviewWindow) {
        let ns_window = match window.ns_window() {
            Ok(ptr) => ptr as *mut AnyObject,
            Err(_) => return,
        };
        if ns_window.is_null() {
            return;
        }
        // SAFETY: messages to a live NSWindow and its standard buttons, on
        // the main thread, with each null checked before use.
        unsafe {
            let style_mask: u64 = msg_send![ns_window, styleMask];
            if style_mask & Self::NS_WINDOW_STYLE_MASK_FULLSCREEN != 0 {
                return;
            }
            let close_btn: *mut AnyObject = msg_send![ns_window, standardWindowButton: 0u64];
            if close_btn.is_null() {
                return;
            }
            let close_frame: NSRect = msg_send![close_btn, frame];
            if close_frame.size.height < 1.0 {
                return;
            }
            let group: *mut AnyObject = msg_send![close_btn, superview];
            if group.is_null() {
                return;
            }
            let container: *mut AnyObject = msg_send![group, superview];
            if container.is_null() {
                return;
            }
            self.resize_container(ns_window, container, close_frame.size.height);
            self.place_buttons(ns_window);
        }
    }

    /// Make the title-bar container `button height + y` tall, pinned to the
    /// window top. The buttons sit at its bottom, so their top lands at `y`.
    unsafe fn resize_container(
        &self,
        ns_window: *mut AnyObject,
        container: *mut AnyObject,
        button_height: f64,
    ) {
        let window_frame: NSRect = msg_send![ns_window, frame];
        let current: NSRect = msg_send![container, frame];
        let height = button_height + self.y;
        let wanted = NSRect {
            origin: NSPoint {
                x: current.origin.x,
                y: window_frame.size.height - height,
            },
            size: NSSize {
                width: current.size.width,
                height,
            },
        };
        if (current.origin.y - wanted.origin.y).abs() > Self::TOLERANCE
            || (current.size.height - wanted.size.height).abs() > Self::TOLERANCE
        {
            let _: () = msg_send![container, setFrame: wanted];
        }
    }

    /// Set each button's x, and keep the cluster visible: AppKit hides it
    /// around fullscreen transitions, which would reflow the header row.
    unsafe fn place_buttons(&self, ns_window: *mut AnyObject) {
        for (index, offset) in Self::BUTTON_SPACING.iter().enumerate() {
            let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: index as u64];
            if button.is_null() {
                continue;
            }
            let hidden: bool = msg_send![button, isHidden];
            if hidden {
                let _: () = msg_send![button, setHidden: false];
            }
            let alpha: f64 = msg_send![button, alphaValue];
            if alpha < 0.999 {
                let _: () = msg_send![button, setAlphaValue: 1.0_f64];
            }
            let current: NSRect = msg_send![button, frame];
            let x = self.x + offset;
            if (current.origin.x - x).abs() <= Self::TOLERANCE {
                continue;
            }
            let moved = NSRect {
                origin: NSPoint {
                    x,
                    y: current.origin.y,
                },
                size: current.size,
            };
            let _: () = msg_send![button, setFrame: moved];
        }
    }
}
