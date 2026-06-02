// Capped exponential backoff for the reconnect supervisor.
//
// Pure, deterministic state machine: `next_delay_secs()` yields 1,2,4,8,16,30,30,…
// (doubling, then clamped at `max_delay_secs`) and advances one step; `reset()`
// returns to the start after a successful connect. Jitter is applied by the caller
// (see `reconnect.rs`) so this core stays deterministic and unit-testable.

/// Doubling backoff clamped at `max_delay_secs`. One instance per connection;
/// `attempt` is the step counter, reset to 0 whenever a connect succeeds.
pub struct ExponentialBackoff {
    attempt: u32,
    max_delay_secs: u64,
}

impl ExponentialBackoff {
    pub fn new(max_delay_secs: u64) -> Self {
        ExponentialBackoff { attempt: 0, max_delay_secs }
    }

    /// Return the delay for the current step (in whole seconds) and advance. The
    /// raw value is `2^attempt`, clamped at `max_delay_secs`; the shift saturates
    /// so a huge attempt count can never overflow.
    pub fn next_delay_secs(&mut self) -> u64 {
        let base = 1u64.checked_shl(self.attempt).unwrap_or(u64::MAX);
        let delay = base.min(self.max_delay_secs);
        self.attempt = self.attempt.saturating_add(1);
        delay
    }

    /// Back to the first step — called after every successful (re)connect.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_then_caps_at_max() {
        let mut b = ExponentialBackoff::new(30);
        let seq: Vec<u64> = (0..8).map(|_| b.next_delay_secs()).collect();
        assert_eq!(seq, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn reset_returns_to_start() {
        let mut b = ExponentialBackoff::new(30);
        b.next_delay_secs(); // 1
        b.next_delay_secs(); // 2
        b.next_delay_secs(); // 4
        b.reset();
        assert_eq!(b.next_delay_secs(), 1, "reset must restart the sequence");
    }

    #[test]
    fn never_overflows_on_large_attempt_counts() {
        let mut b = ExponentialBackoff::new(30);
        // Drive far past the point where 2^attempt overflows u64 — must stay capped.
        let mut last = 0;
        for _ in 0..200 {
            last = b.next_delay_secs();
        }
        assert_eq!(last, 30);
    }
}
