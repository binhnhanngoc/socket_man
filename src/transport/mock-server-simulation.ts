// Fake WebSocket server simulation, ported from design/data.js makeServer().
// Holds subscriptions, replies to commands, emits server-initiated frames on a
// tick. Returns frame STUBS ({ dir, kind, body }); the mock transport wraps each
// into a complete Frame (id/ts/size) before handing it to the UI.

export interface FrameStub {
  dir: "in" | "out" | "sys";
  kind: string;
  body: unknown;
}

function rnd(min: number, max: number, dp = 1): number {
  const v = min + Math.random() * (max - min);
  return Number(v.toFixed(dp));
}

const CHANNEL_GEN: Record<string, () => Record<string, unknown>> = {
  "boiler.3": () => ({ kwh: rnd(780, 920), temp_c: rnd(305, 332), efficiency: rnd(86, 94) }),
  "chiller.loop": () => ({ kwh: rnd(420, 560), flow_m3h: rnd(180, 240) }),
  "water.intake": () => ({ flow_m3h: rnd(90, 140), turbidity: rnd(0.4, 1.8, 2) }),
};

export interface MockServer {
  subs: Set<string>;
  handle(body: Record<string, unknown>): FrameStub[];
  tick(): FrameStub[];
  welcome(): FrameStub;
}

export function makeMockServer(): MockServer {
  return {
    subs: new Set<string>(),
    handle(body) {
      const replies: FrameStub[] = [];
      const a = body && (body.action as string);
      if (a === "subscribe") {
        const ch = (body.channel as string) || (body.market as string) || "stream";
        this.subs.add(ch);
        replies.push({ dir: "in", kind: "ack", body: { ok: true, subscribed: ch, ts: Date.now() } });
      } else if (a === "unsubscribe") {
        if (body.channel === "*") this.subs.clear();
        else this.subs.delete(body.channel as string);
        replies.push({ dir: "in", kind: "ack", body: { ok: true, unsubscribed: body.channel } });
      } else if (a === "ping") {
        replies.push({ dir: "in", kind: "pong", body: { pong: true, rttMs: rnd(8, 40, 0) } });
      } else if (a === "config") {
        replies.push({ dir: "in", kind: "ack", body: { ok: true, applied: body } });
      } else if (a === "ack") {
        replies.push({ dir: "in", kind: "ack", body: { ok: true, acknowledged: body.alertId } });
      } else if (a === "start" || a === "step" || a === "reset") {
        replies.push({
          dir: "in",
          kind: "event",
          body: { scenario: body.scenario || "A", state: a, projectedSavingUSD: rnd(180000, 340000, 0) },
        });
      } else {
        replies.push({ dir: "in", kind: "ack", body: { ok: true, received: a || "message" } });
      }
      return replies;
    },
    tick() {
      const frames: FrameStub[] = [];
      this.subs.forEach((ch) => {
        if (CHANNEL_GEN[ch]) {
          frames.push({ dir: "in", kind: "telemetry", body: { ch, ts: Math.floor(Date.now() / 1000), ...CHANNEL_GEN[ch]() } });
        } else if (ch === "alerts") {
          if (Math.random() < 0.25)
            frames.push({
              dir: "in",
              kind: "alert",
              body: {
                id: "AL-" + (200 + Math.floor(Math.random() * 99)),
                severity: ["info", "warning", "critical"][Math.floor(Math.random() * 3)],
                bot: "B-0" + (10 + Math.floor(Math.random() * 30)),
                msg: "efficiency below baseline",
              },
            });
        } else {
          frames.push({ dir: "in", kind: "tick", body: { node: ch, priceUSDMWh: rnd(28, 76, 2), ts: Math.floor(Date.now() / 1000) } });
        }
      });
      return frames;
    },
    welcome() {
      return { dir: "in", kind: "open", body: { server: "socketman-mock/1.0.0", region: "local", heartbeat: 30, ts: Date.now() } };
    },
  };
}
