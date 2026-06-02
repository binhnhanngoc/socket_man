// Minimal local echo server for the hermetic e2e (no external network / flaky DNS).
// One HTTP server, shared by an HTTP echo handler and a WebSocket echo (via `ws`,
// the reference implementation tokio-tungstenite interops with).
//
// - HTTP: any method → 200 JSON reflecting { method, path, headers, body }.
// - WS: greeting frame on open, then echoes every text/binary message.

import http from "node:http";
import { WebSocketServer } from "ws";

export function startEchoServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body }));
      });
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
      if (process.env.ECHO_DEBUG) console.error("[echo] WS connection open");
      ws.send(JSON.stringify({ server: "local-echo", ok: true }));
      ws.on("message", (data, isBinary) => {
        if (process.env.ECHO_DEBUG) console.error(`[echo] echo ${data.length} bytes`);
        ws.send(isBinary ? data : data.toString());
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        close: () => {
          wss.close();
          server.close();
        },
      });
    });
  });
}
