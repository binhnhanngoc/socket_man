// Mock Transport implementation — reproduces the prototype's fake server behind
// the real Transport interface, so Phase 2 can swap in the Rust transport with
// zero UI changes. It assembles complete Frame objects (id/ts/size) the same way
// the Rust side will (frames assembled transport-side, not in the UI).

import { byteSize } from "../lib/util";
import { makeMockServer, type FrameStub, type MockServer } from "./mock-server-simulation";
import type { Frame, HttpRequest, HttpResponse, Transport } from "./transport";

let FRAME_SEQ = 0;
let CONN_SEQ = 0;
const TICK_MS = 1200;
const CONNECT_DELAY_MS = 620;
const REPLY_DELAY_MS = 240;

function toFrame(stub: FrameStub): Frame {
  return { id: ++FRAME_SEQ, dir: stub.dir, kind: stub.kind, body: stub.body, ts: Date.now(), size: byteSize(stub.body) };
}

interface MockConn {
  onFrame: (f: Frame[]) => void;
  // During the connect delay only `connectTimer` is set; once connected,
  // `server` + `tick` are set and `connectTimer` is cleared.
  connectTimer?: ReturnType<typeof setTimeout>;
  server?: MockServer;
  tick?: ReturnType<typeof setInterval>;
}

const conns = new Map<string, MockConn>();

function teardown(connId: string) {
  const conn = conns.get(connId);
  if (!conn) return;
  if (conn.connectTimer) clearTimeout(conn.connectTimer);
  if (conn.tick) clearInterval(conn.tick);
  conn.server?.subs.clear();
  conns.delete(connId);
}

export const mockTransport: Transport = {
  wsConnect(_cfg, onFrame, onStatus) {
    const connId = "mock-" + ++CONN_SEQ;
    // Register the connection immediately (status "connecting") so a disconnect
    // during the connect delay can cancel the pending connect — without this the
    // pending timer would resurrect a zombie "connected" socket + leaked tick.
    const conn: MockConn = { onFrame };
    conns.set(connId, conn);
    onStatus({ connId, status: "connecting" });
    conn.connectTimer = setTimeout(() => {
      const server = makeMockServer();
      conn.connectTimer = undefined;
      conn.server = server;
      conn.tick = setInterval(() => {
        const frames = server.tick();
        if (frames.length) onFrame(frames.map(toFrame));
      }, TICK_MS);
      onStatus({ connId, status: "connected", connectedAt: Date.now() });
      onFrame([toFrame(server.welcome())]);
    }, CONNECT_DELAY_MS);
    return Promise.resolve(connId);
  },

  wsSend(connId, payload) {
    const conn = conns.get(connId);
    // Only a fully-connected socket (has a server) can send.
    if (!conn || !conn.server) return Promise.resolve();
    // Parse the serialized payload back to an object for the fake server. If it
    // isn't JSON, send a raw stub. (The real Rust transport sends bytes verbatim.)
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payload);
      body = parsed && typeof parsed === "object" ? parsed : { raw: payload };
    } catch {
      body = { raw: payload };
    }
    // Echo the out-frame, then schedule the simulated replies.
    conn.onFrame([toFrame({ dir: "out", kind: (body.action as string) || "message", body })]);
    const replies = conn.server.handle(body);
    setTimeout(() => conn.onFrame(replies.map(toFrame)), REPLY_DELAY_MS);
    return Promise.resolve();
  },

  wsDisconnect(connId) {
    const conn = conns.get(connId);
    if (conn) {
      const onFrame = conn.onFrame;
      // Cancels a pending connect (if still connecting) or stops the tick (if
      // connected); either way the close is acknowledged with a sys frame.
      teardown(connId);
      onFrame([toFrame({ dir: "sys", kind: "closed", body: { reason: "client disconnect", code: 1000 } })]);
    }
    return Promise.resolve();
  },

  httpSend(req: HttpRequest): Promise<HttpResponse> {
    const body =
      req.method === "GET"
        ? { bots: 42, online: 40, snapshotTs: Math.floor(Date.now() / 1000), totals: { kwh: 1284902, co2e_t: 1240 } }
        : { ok: true, scenarioId: "SC-7741", queued: true, etaSeconds: 18 };
    const text = JSON.stringify(body, null, 2);
    return Promise.resolve({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: text,
      timingMs: 280 + Math.floor(Math.random() * 80),
      sizeBytes: new Blob([text]).size,
    });
  },
};
