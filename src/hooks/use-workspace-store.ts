// use-workspace-store — the COORDINATING store (F15).
//
// The prototype App() cross-couples item/connection/message state: duplicate
// ops mutate urls + conns + msgs together, and send spans connections + draft +
// format. Splitting that into five independent hooks would force them to import
// each other's setters (worse coupling). Instead this single store owns that
// shared state + the atomic cross-state operations, and exposes the
// Transport-calling surface (connect/send/disconnect) so Phase 2 can swap the
// Transport impl with NO signature change.
//
// NOTE (F15): this file intentionally exceeds the 200-LOC target. The state here
// is one logically-cohesive unit; fragmenting it would create artificial
// coupling. The independent prefs (tweaks/panels/environments) live in their own
// thin hooks; the UI-only 1200ms clock stays in App.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Collection, ConnMap, ConnMeta, ConnMetaMap, ConnState, Environment, MessageMap, SavedMessage } from "../types";
import type { Frame } from "../transport/transport";
import { transport } from "../transport";
import { COLLECTIONS, MESSAGES } from "../data/starter-data";
import { serialize, parseFmt, type Format } from "../formats/serialize";
import { resolveEnv } from "../lib/resolve-env";
import { secretRefsFor } from "../lib/secret-refs";
import { appendHistory } from "../lib/history-log";

const MAX_FRAMES = 400;
// Server-initiated tick kinds — these are what "pause stream" suppresses (the
// prototype paused the whole tick, which only ever emitted these).
const TICK_KINDS = new Set(["telemetry", "alert", "tick"]);

const uid = (p: string) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function loadCollections(): Collection[] {
  try {
    const s = localStorage.getItem("relay.collections");
    if (s) return JSON.parse(s);
  } catch {
    // ignore
  }
  // migrate from earlier name-override storage
  let cn: Record<string, string> = {};
  let iN: Record<string, string> = {};
  try {
    cn = JSON.parse(localStorage.getItem("relay.collNames") || "{}");
  } catch {
    // ignore
  }
  try {
    iN = JSON.parse(localStorage.getItem("relay.itemNames") || "{}");
  } catch {
    // ignore
  }
  return COLLECTIONS.map((c) => ({
    ...c,
    name: cn[c.id] || c.name,
    items: c.items.map((it) => ({ ...it, name: iN[it.id] || it.name })),
  }));
}

function freshConn(): ConnState {
  return { status: "disconnected", frames: [], connectedAt: null };
}

function freshMeta(): ConnMeta {
  // Start empty: the user adds headers / an auth token. (Starter demo headers are
  // seeded in Phase 6's rebrand, not hardcoded here.) Auto-reconnect defaults on;
  // insecure-TLS defaults off (a footgun the user must opt into per connection).
  return { headers: [], authType: "none", authToken: "", reconnect: true, insecureTls: false };
}

// Compose the per-item header rows + Auth pane into the outbound header map. Values
// are env-resolved with skipSecret so a {{secret}} stays literal and is substituted
// Rust-side at connect (Phase 5); non-secret {{vars}} resolve here.
function composeHeaders(meta: ConnMeta | undefined, env: Environment | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta) return out;
  for (const row of meta.headers) {
    const key = row.k.trim();
    if (key) out[key] = resolveEnv(row.v, env, { skipSecret: true });
  }
  if (meta.authType === "bearer" && meta.authToken.trim()) {
    out["Authorization"] = "Bearer " + resolveEnv(meta.authToken.trim(), env, { skipSecret: true });
  }
  return out;
}

function bootstrap() {
  const collections = loadCollections();
  const items = collections.flatMap((c) => c.items);
  const conns: ConnMap = {};
  const connMeta: ConnMetaMap = {};
  items.forEach((it) => {
    if (it.kind === "ws") {
      conns[it.id] = freshConn();
      connMeta[it.id] = freshMeta();
    }
  });
  const urls = Object.fromEntries(items.map((i) => [i.id, i.url]));
  const msgs: MessageMap = JSON.parse(JSON.stringify(MESSAGES));
  return { collections, conns, connMeta, urls, msgs };
}

export function useWorkspaceStore(activeEnv: Environment | null) {
  const boot = useRef<ReturnType<typeof bootstrap>>();
  if (!boot.current) boot.current = bootstrap();

  const [collections, setCollections] = useState<Collection[]>(boot.current.collections);
  const [conns, setConns] = useState<ConnMap>(boot.current.conns);
  const [connMeta, setConnMeta] = useState<ConnMetaMap>(boot.current.connMeta);
  const [urls, setUrls] = useState<Record<string, string>>(boot.current.urls);
  const [msgs, setMsgs] = useState<MessageMap>(boot.current.msgs);
  const [activeId, setActiveId] = useState("ws-echo");
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [fmt, setFmt] = useState<Format>("json");
  const [draft, setDraft] = useState('{\n  "action": "subscribe",\n  "channel": "boiler.3",\n  "fields": ["kwh", "temp_c", "efficiency"]\n}');
  const [msgCollNames, setMsgCollNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("relay.msgCollNames") || "{}");
    } catch {
      return {};
    }
  });

  // Collections live durably in the Rust JSON store. Hydrate from it on mount (the
  // localStorage seed migrates in on first write), and mirror every change back.
  const collsHydrated = useRef(false);
  useEffect(() => {
    let live = true;
    transport
      .storageLoad("collections")
      .then((d) => {
        if (live && Array.isArray(d) && d.length) setCollections(d as Collection[]);
      })
      .catch(() => {})
      .finally(() => {
        collsHydrated.current = true;
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!collsHydrated.current) return;
    transport.storageSave("collections", collections).catch(() => {});
  }, [collections]);

  // Refs read by transport callbacks (avoid stale closures).
  const connIdMap = useRef<Record<string, string>>({});
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const envRef = useRef(activeEnv);
  envRef.current = activeEnv;
  const metaRef = useRef(connMeta);
  metaRef.current = connMeta;

  const allItems = useMemo(() => collections.flatMap((c) => c.items), [collections]);
  const statuses = useMemo(
    () => Object.fromEntries(Object.entries(conns).map(([k, v]) => [k, v.status])),
    [conns]
  );

  const persistColls = useCallback((next: Collection[]) => {
    setCollections(next);
    try {
      localStorage.setItem("relay.collections", JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  // ---- transport-fed state ----
  const ingest = useCallback((id: string, frames: Frame[]) => {
    const visible = pausedRef.current
      ? frames.filter((f) => !(f.dir === "in" && TICK_KINDS.has(f.kind)))
      : frames;
    if (!visible.length) return;
    setConns((prev) => {
      const c = prev[id];
      if (!c) return prev;
      let next = c.frames.concat(visible);
      if (next.length > MAX_FRAMES) next = next.slice(next.length - MAX_FRAMES);
      return { ...prev, [id]: { ...c, frames: next } };
    });
  }, []);

  const connect = useCallback(
    (id: string) => {
      const item = allItems.find((i) => i.id === id);
      if (!item) return;
      const meta = metaRef.current[id];
      // Re-warn at EVERY connect when TLS verification is disabled (it persists on the
      // item, so a saved `true` must never reconnect silently). Cancel aborts connect.
      if (meta?.insecureTls) {
        const ok = window.confirm(
          "⚠ TLS verification is DISABLED for this connection.\n\n" +
            "All certificate, expiry, and hostname checks are turned off — the connection " +
            "is fully exposed to man-in-the-middle interception. Only continue for a trusted " +
            "self-signed dev endpoint.\n\nConnect anyway?"
        );
        if (!ok) return;
      }
      // Resolve only NON-secret tokens for the URL; secret tokens stay literal
      // ({{token}}) and are substituted Rust-side at connect (Phase 5).
      const url = resolveEnv(urls[id] || item.url, envRef.current, { skipSecret: true });
      const headers = composeHeaders(meta, envRef.current);
      const cfg = {
        url,
        headers,
        reconnect: { enabled: meta?.reconnect ?? true },
        insecureTls: !!meta?.insecureTls,
      };
      // Secret tokens in the URL/headers stay literal here ({{token}}) and resolve
      // Rust-side from the keychain using the active env's secret keys.
      const secrets = secretRefsFor(envRef.current);
      setConns((p) => ({ ...p, [id]: { ...p[id], status: "connecting" } }));
      transport
        .wsConnect(cfg, (frames) => ingest(id, frames), (s) => {
          setConns((p) => {
            const c = p[id];
            if (!c) return p;
            // A fresh (re)connect carries connectedAt (supervisor stamps it) → use it,
            // restarting the timer. A heartbeat/rtt update carries none → preserve the
            // existing connectedAt so the live timer doesn't reset on every ping.
            const connectedAt =
              s.status === "connected"
                ? s.connectedAt ?? c.connectedAt ?? Date.now()
                : s.status === "disconnected"
                  ? null
                  : c.connectedAt;
            const rttMs = s.status === "disconnected" ? undefined : s.rttMs ?? c.rttMs;
            return { ...p, [id]: { ...c, status: s.status, connectedAt, rttMs } };
          });
        }, secrets)
        .then((connId) => {
          connIdMap.current[id] = connId;
        });
    },
    [allItems, urls, ingest]
  );

  const disconnect = useCallback((id: string) => {
    const connId = connIdMap.current[id];
    if (connId) {
      transport.wsDisconnect(connId);
      // Append a session summary in TEMPLATE form (the user-typed url, secret tokens
      // still literal) — only when there actually was a live connection.
      const tmplUrl = urls[id] || allItems.find((i) => i.id === id)?.url || "";
      appendHistory({ kind: "ws", itemId: id, label: tmplUrl, summary: "session ended", payload: { url: tmplUrl } });
    }
    setConns((p) => (p[id] ? { ...p, [id]: { ...p[id], status: "disconnected", connectedAt: null } } : p));
  }, [urls, allItems]);

  const sendBody = useCallback((id: string, body: unknown) => {
    const connId = connIdMap.current[id];
    if (connId) transport.wsSend(connId, serialize(body, "json"), secretRefsFor(envRef.current));
  }, []);

  // ---- draft / saved messages ----
  const sendSaved = useCallback(
    (msg: SavedMessage) => {
      setDraft(serialize(msg.body, fmt));
      const c = conns[activeId];
      if (c && c.status === "connected") sendBody(activeId, msg.body);
    },
    [fmt, conns, activeId, sendBody]
  );
  const loadSaved = useCallback((msg: SavedMessage) => setDraft(serialize(msg.body, fmt)), [fmt]);

  const changeFmt = useCallback(
    (next: Format) => {
      if (next === fmt) return;
      setDraft((d) => {
        try {
          return serialize(parseFmt(d, fmt), next);
        } catch {
          return d;
        }
      });
      setFmt(next);
    },
    [fmt]
  );

  // ---- renames ----
  const renameColl = useCallback(
    (id: string, name: string) => persistColls(collections.map((c) => (c.id === id ? { ...c, name } : c))),
    [collections, persistColls]
  );
  const renameItem = useCallback(
    (id: string, name: string) =>
      persistColls(collections.map((c) => ({ ...c, items: c.items.map((it) => (it.id === id ? { ...it, name } : it)) }))),
    [collections, persistColls]
  );
  const renameMsgColl = useCallback((id: string, name: string) => {
    setMsgCollNames((p) => {
      const n = { ...p, [id]: name };
      try {
        localStorage.setItem("relay.msgCollNames", JSON.stringify(n));
      } catch {
        // ignore
      }
      return n;
    });
  }, []);
  const renameMsg = useCallback(
    (msgId: string, name: string) =>
      setMsgs((p) => ({ ...p, [activeId]: (p[activeId] || []).map((m) => (m.id === msgId ? { ...m, name } : m)) })),
    [activeId]
  );

  // ---- duplicate: collection / endpoint / message (atomic cross-state) ----
  const ensureWsState = useCallback((origId: string, newId: string, srcUrl: string) => {
    setUrls((p) => ({ ...p, [newId]: p[origId] || srcUrl }));
    setConns((p) => ({ ...p, [newId]: freshConn() }));
    // Copy the headers/auth meta to the duplicate, but NOT the runtime connId
    // (connIdMap is keyed by item id; the new id has no entry → connId stays null,
    // so the copy never aliases the source's live socket — F10).
    setConnMeta((p) => ({ ...p, [newId]: p[origId] ? JSON.parse(JSON.stringify(p[origId])) : freshMeta() }));
    setMsgs((p) => ({ ...p, [newId]: JSON.parse(JSON.stringify(p[origId] || MESSAGES[origId] || [])) }));
  }, []);

  const duplicateCollection = useCallback(
    (id: string) => {
      const idx = collections.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const src = collections[idx];
      const items = src.items.map((it) => {
        const nid = uid(it.kind);
        if (it.kind === "ws") ensureWsState(it.id, nid, it.url);
        else setUrls((p) => ({ ...p, [nid]: p[it.id] || it.url }));
        return { ...it, id: nid };
      });
      const copy: Collection = { ...src, id: uid("c"), name: src.name + " copy", items };
      persistColls([...collections.slice(0, idx + 1), copy, ...collections.slice(idx + 1)]);
    },
    [collections, ensureWsState, persistColls]
  );

  const duplicateItem = useCallback(
    (id: string) => {
      let ci = -1;
      let ii = -1;
      collections.forEach((c, x) => {
        const y = c.items.findIndex((it) => it.id === id);
        if (y >= 0) {
          ci = x;
          ii = y;
        }
      });
      if (ci < 0) return;
      const src = collections[ci].items[ii];
      const nid = uid(src.kind);
      if (src.kind === "ws") ensureWsState(src.id, nid, src.url);
      else setUrls((p) => ({ ...p, [nid]: p[src.id] || src.url }));
      const copy = { ...src, id: nid, name: src.name + " copy" };
      persistColls(
        collections.map((c, x) =>
          x !== ci ? c : { ...c, items: [...c.items.slice(0, ii + 1), copy, ...c.items.slice(ii + 1)] }
        )
      );
      setActiveId(nid);
      setActiveMsgId(null);
    },
    [collections, ensureWsState, persistColls]
  );

  const duplicateMsg = useCallback(
    (msgId: string) =>
      setMsgs((p) => {
        const list = p[activeId] || [];
        const idx = list.findIndex((m) => m.id === msgId);
        if (idx < 0) return p;
        const copy = { ...list[idx], id: uid("m"), name: list[idx].name + " copy", fav: false };
        return { ...p, [activeId]: [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)] };
      }),
    [activeId]
  );

  const reorderMsgs = useCallback((next: SavedMessage[]) => setMsgs((p) => ({ ...p, [activeId]: next })), [activeId]);
  const setUrl = useCallback((id: string, v: string) => setUrls((p) => ({ ...p, [id]: v })), []);
  // Headers/Auth pane editing → per-item connection meta (composed into headers at connect).
  const updateMeta = useCallback(
    (id: string, patch: Partial<ConnMeta>) => setConnMeta((p) => ({ ...p, [id]: { ...(p[id] || freshMeta()), ...patch } })),
    []
  );
  const clearFrames = useCallback(
    (id: string) => setConns((p) => (p[id] ? { ...p, [id]: { ...p[id], frames: [] } } : p)),
    []
  );

  const activeItem = allItems.find((i) => i.id === activeId);
  const activeItemWithUrl = activeItem ? { ...activeItem, url: urls[activeItem.id] || activeItem.url } : null;
  const activeConn = activeItem && activeItem.kind === "ws" ? conns[activeId] : null;
  const activeMeta = activeItem && activeItem.kind === "ws" ? connMeta[activeId] || freshMeta() : null;

  return {
    collections,
    msgs,
    activeId,
    activeMsgId,
    paused,
    fmt,
    draft,
    msgCollNames,
    statuses,
    activeItemWithUrl,
    activeConn,
    activeMeta,
    setActiveId,
    setActiveMsgId,
    setPaused,
    setDraft,
    changeFmt,
    connect,
    disconnect,
    sendBody,
    sendSaved,
    loadSaved,
    setUrl,
    updateMeta,
    clearFrames,
    renameColl,
    renameItem,
    renameMsgColl,
    renameMsg,
    duplicateCollection,
    duplicateItem,
    duplicateMsg,
    reorderMsgs,
  };
}
