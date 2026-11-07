//! Why a pack was refused. The `Display` text is what the shell logs.

use std::fmt;

/// Why a base64url JSON segment could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SegmentError {
    NotBase64,
    NotJson,
}

impl fmt::Display for SegmentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SegmentError::NotBase64 => "not base64url",
            SegmentError::NotJson => "not JSON",
        })
    }
}

/// Every reason a pack is no group layer at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackError {
    NotCompact,
    Header(SegmentError),
    CriticalHeader,
    NotAPack,
    NotRs256,
    NoKey,
    NoPinnedKey,
    Signature(SegmentError),
    SignatureMismatch,
    Payload(SegmentError),
    ApiUrlUnset,
    OtherIssuer,
    NobodySignedIn,
    OtherSubject,
    NoVersion,
    Rollback,
    NoPolicy,
}

impl fmt::Display for PackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            PackError::Header(why) => return write!(f, "header {why}"),
            PackError::Signature(why) => return write!(f, "signature {why}"),
            PackError::Payload(why) => return write!(f, "payload {why}"),
            PackError::NotCompact => "not a compact JWS",
            PackError::CriticalHeader => "critical header parameters",
            PackError::NotAPack => "not a group pack",
            PackError::NotRs256 => "not RS256",
            PackError::NoKey => "no key to check against",
            PackError::NoPinnedKey => "no pinned key available",
            PackError::SignatureMismatch => "signature does not verify",
            PackError::ApiUrlUnset => "api_url is not set",
            PackError::OtherIssuer => "issued by another server",
            PackError::NobodySignedIn => "nobody is signed in",
            PackError::OtherSubject => "issued for somebody else",
            PackError::NoVersion => "no version",
            PackError::Rollback => "older than a pack already applied",
            PackError::NoPolicy => "no policy",
        };
        f.write_str(text)
    }
}
