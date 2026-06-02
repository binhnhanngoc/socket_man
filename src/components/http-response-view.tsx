// HTTP response view: status pill (colored by class), timing + size meta, response
// headers list, and a pretty body via FormatView. The body format auto-detects JSON
// vs Text from the content-type, with a manual JSON/Text override.
import { useMemo, useState } from "react";
import type { HttpResponse } from "../transport/transport";
import { FormatView } from "../formats/format-view";
import { parseFmt } from "../formats/serialize";

// 2xx green, 4xx amber, 5xx red — mapped to inline colors so no new CSS is needed.
function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "var(--leaf)";
  if (status >= 400 && status < 500) return "var(--solar)";
  if (status >= 500) return "var(--rust)";
  return "var(--stone)";
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

type View = "json" | "text";

export function HttpResponseView({ response }: { response: HttpResponse }) {
  const ctype = (response.headers["content-type"] || "").toLowerCase();
  const looksJson = ctype.includes("json");
  const [view, setView] = useState<View>(looksJson ? "json" : "text");

  // For the JSON view, parse the body; if it doesn't parse, fall back to raw text.
  const parsed = useMemo<{ value: unknown; ok: boolean }>(() => {
    try {
      return { value: parseFmt(response.body, "json"), ok: true };
    } catch {
      return { value: response.body, ok: false };
    }
  }, [response.body]);

  const showJson = view === "json" && parsed.ok;

  return (
    <div className="http-resp">
      <div className="lib-section">
        Response
        <span className="resp-meta">
          <span
            className="status-pill"
            style={{ background: statusColor(response.status), color: "var(--paper)", padding: "1px 7px", borderRadius: 5, marginRight: 8 }}
          >
            {response.status} {response.statusText}
          </span>
          {response.timingMs} ms · {fmtBytes(response.sizeBytes)}
        </span>
      </div>

      <div className="composer-head">
        <span className="pane-title sm">Body</span>
        <div className="seg fmt-seg sm">
          <button className={"seg-btn" + (view === "json" ? " on" : "")} onClick={() => setView("json")} disabled={!parsed.ok}>
            JSON
          </button>
          <button className={"seg-btn" + (view === "text" ? " on" : "")} onClick={() => setView("text")}>
            Text
          </button>
        </div>
      </div>
      <FormatView value={showJson ? parsed.value : response.body} fmt={showJson ? "json" : "text"} />

      {Object.keys(response.headers).length > 0 && (
        <>
          <div className="lib-section">Response headers</div>
          <div className="kv-list">
            {Object.entries(response.headers).map(([k, v]) => (
              <div className="kv-row resp-hdr" key={k}>
                <span className="kv-k mono">{k}</span>
                <span className="kv-v mono">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
