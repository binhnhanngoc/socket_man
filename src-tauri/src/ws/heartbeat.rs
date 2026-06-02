// Heartbeat liveness state machine — our OUTBOUND ping/pong probe.
//
// This is the dead-socket detector. A single timeout wrapped around the ping loop
// (the research §4 example) is structurally dead: it never observes whether a pong
// came back. Instead we keep one explicit bit, `awaiting_pong`:
//
//   - on each ping tick: if `awaiting_pong` is STILL true, the previous pong never
//     arrived ⇒ the socket is dead → reconnect. Otherwise send a ping and set the bit.
//   - on a pong: clear the bit and measure RTT.
//
// One ping per interval guarantees at most one outstanding probe, so a returning
// pong is unambiguous. tungstenite auto-answers INBOUND pings itself; this module is
// only about our own liveness probe. The ping payload is an 8-byte big-endian send
// timestamp (ms) so RTT = now − decode(pong). No secrets ride the payload.

/// What a ping-interval tick should do, given the current liveness state.
#[derive(Debug, PartialEq, Eq)]
pub enum HeartbeatTick {
    /// Previous pong never arrived — the socket is dead, break to reconnect.
    Dead,
    /// Send a fresh ping (payload from `encode_ping`).
    SendPing,
}

/// One bit of liveness state per connection.
#[derive(Default)]
pub struct Heartbeat {
    awaiting_pong: bool,
}

impl Heartbeat {
    pub fn new() -> Self {
        Heartbeat { awaiting_pong: false }
    }

    /// Drive one ping-interval tick. Returns `Dead` if we were still waiting on the
    /// previous pong (missed pong ⇒ dead), else `SendPing` and arms the wait.
    pub fn on_tick(&mut self) -> HeartbeatTick {
        if self.awaiting_pong {
            HeartbeatTick::Dead
        } else {
            self.awaiting_pong = true;
            HeartbeatTick::SendPing
        }
    }

    /// A pong arrived — clear the outstanding-probe flag.
    pub fn on_pong(&mut self) {
        self.awaiting_pong = false;
    }
}

/// Encode a ping payload: the send timestamp (ms) as 8 big-endian bytes.
pub fn encode_ping(now_ms: u64) -> Vec<u8> {
    now_ms.to_be_bytes().to_vec()
}

/// Decode a pong payload (our own echoed timestamp) and compute RTT against `now_ms`.
/// Returns `None` for a payload we did not author (wrong length) so foreign pongs
/// never produce a bogus RTT. `saturating_sub` guards a non-monotonic clock.
pub fn rtt_from_pong(payload: &[u8], now_ms: u64) -> Option<u64> {
    if payload.len() != 8 {
        return None;
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(payload);
    let sent = u64::from_be_bytes(bytes);
    Some(now_ms.saturating_sub(sent))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_tick_sends_ping_and_arms_wait() {
        let mut hb = Heartbeat::new();
        assert_eq!(hb.on_tick(), HeartbeatTick::SendPing);
    }

    #[test]
    fn second_tick_without_pong_is_dead() {
        let mut hb = Heartbeat::new();
        assert_eq!(hb.on_tick(), HeartbeatTick::SendPing); // arms awaiting_pong
        assert_eq!(hb.on_tick(), HeartbeatTick::Dead, "missed pong by next tick ⇒ dead");
    }

    #[test]
    fn pong_clears_wait_so_next_tick_sends_again() {
        let mut hb = Heartbeat::new();
        hb.on_tick(); // SendPing, awaiting
        hb.on_pong(); // pong arrived
        assert_eq!(hb.on_tick(), HeartbeatTick::SendPing, "a cleared wait must ping again, not die");
    }

    #[test]
    fn rtt_is_now_minus_encoded_send_time() {
        let payload = encode_ping(1000);
        assert_eq!(rtt_from_pong(&payload, 1042), Some(42));
    }

    #[test]
    fn foreign_or_malformed_pong_yields_no_rtt() {
        assert_eq!(rtt_from_pong(&[1, 2, 3], 9999), None);
        assert_eq!(rtt_from_pong(&[], 9999), None);
    }

    #[test]
    fn non_monotonic_clock_does_not_underflow() {
        let payload = encode_ping(2000);
        assert_eq!(rtt_from_pong(&payload, 1000), Some(0), "clock went backwards ⇒ clamp to 0");
    }
}
