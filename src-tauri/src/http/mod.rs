// HTTP transport (Phase 4). Disjoint from `ws/`: a single strict reqwest client
// (rustls + rustls-platform-verifier → Windows cert store, same TLS story as WS).
// There is NO insecure-TLS HTTP path in v1 — the self-signed toggle is wss-only.

pub mod client;
pub mod types;
