// A tiny, cloneable cancellation token (F7) — sticky flag + a `Notify` to wake any
// waiter. Used both as the inner `run_connection` disconnect signal (instant on a
// live socket) and to interrupt the supervisor's backoff sleep (instant mid-wait).
//
// Why not `tokio_util::sync::CancellationToken`? It is not in the offline crate cache
// here; this is the same contract in ~30 lines on `tokio::sync::Notify` (already a
// dependency). The only subtlety is the cancel-vs-await race: `cancelled()` registers
// interest via `Notified::enable()` and re-checks the flag, so a `cancel()` racing the
// await never goes unobserved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::Notify;

#[derive(Clone, Default)]
pub struct Cancel {
    inner: Arc<CancelInner>,
}

#[derive(Default)]
struct CancelInner {
    flag: AtomicBool,
    notify: Notify,
}

impl Cancel {
    pub fn new() -> Self {
        Cancel::default()
    }

    /// Mark cancelled and wake every current waiter. Idempotent.
    pub fn cancel(&self) {
        self.inner.flag.store(true, Ordering::SeqCst);
        self.inner.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.flag.load(Ordering::SeqCst)
    }

    /// Resolve as soon as the token is cancelled — now or later. Safe to use as a
    /// `select!` arm: each call is a fresh future, and the sticky flag means even a
    /// missed wake is caught on the next poll.
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        let notified = self.inner.notify.notified();
        tokio::pin!(notified);
        // Register BEFORE the second flag check so a cancel() between the checks still
        // wakes this waiter (notify_waiters only wakes already-registered waiters).
        notified.as_mut().enable();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::timeout;

    #[tokio::test]
    async fn cancelled_resolves_after_cancel() {
        let c = Cancel::new();
        assert!(!c.is_cancelled());
        let c2 = c.clone();
        tokio::spawn(async move {
            c2.cancel();
        });
        timeout(Duration::from_secs(1), c.cancelled()).await.expect("cancelled should resolve");
        assert!(c.is_cancelled());
    }

    #[tokio::test]
    async fn already_cancelled_is_immediate() {
        let c = Cancel::new();
        c.cancel();
        // Fast path: must resolve without awaiting a wake.
        timeout(Duration::from_millis(50), c.cancelled()).await.expect("already-cancelled is instant");
    }

    #[tokio::test]
    async fn cancel_during_select_wins_over_long_sleep() {
        let c = Cancel::new();
        let c2 = c.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            c2.cancel();
        });
        // The sleep is far longer than the cancel delay — cancel must win the select.
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(30)) => panic!("sleep should not win"),
            _ = c.cancelled() => {}
        }
    }
}
