// WS engine module. `connection`, `request`, and `reconnect` are public so
// integration tests can drive the single-task loop and the supervising reconnect
// loop directly over both ws:// and wss:// streams.

pub mod backoff;
pub mod cancel;
pub mod connection;
pub mod heartbeat;
pub mod manager;
pub mod reconnect;
pub mod request;
pub mod tls;
pub mod types;
