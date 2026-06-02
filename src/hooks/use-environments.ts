// Environment CRUD + active-environment selection, ported from design/app.jsx.
// Persists to localStorage (Phase 5 migrates the data store to Rust JSON).
// Re-exports the SECURITY-CRITICAL secret-skipping resolveEnv so call sites have
// one import surface.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Environment } from "../types";
import { ENVIRONMENTS } from "../data/starter-data";
import { resolveEnv } from "../lib/resolve-env";
import { transport } from "../transport";

export { resolveEnv } from "../lib/resolve-env";

export interface EditEnvRef {
  id: string;
  isNew: boolean;
}

function loadEnvs(): Environment[] {
  try {
    const s = localStorage.getItem("relay.environments");
    if (s) return JSON.parse(s);
  } catch {
    // ignore
  }
  return ENVIRONMENTS;
}

function loadActiveId(): string | null {
  try {
    const s = localStorage.getItem("relay.activeEnv");
    if (s !== null) return s === "" ? null : s;
  } catch {
    // ignore
  }
  return "env-local";
}

export function useEnvironments() {
  const [environments, setEnvironments] = useState<Environment[]>(loadEnvs);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(loadActiveId);
  const [editEnv, setEditEnv] = useState<EditEnvRef | null>(null);

  // JSON store is the durable home (Rust-owned files). On mount, hydrate from it if it
  // has data; otherwise the localStorage seed above migrates into it on first write.
  const hydrated = useRef(false);
  useEffect(() => {
    let live = true;
    transport
      .storageLoad("environments")
      .then((d) => {
        if (live && Array.isArray(d) && d.length) setEnvironments(d as Environment[]);
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true;
      });
    return () => {
      live = false;
    };
  }, []);

  // Mirror every environments change to the JSON store (one place covers all
  // mutations). Skip until hydration so the seed can't clobber stored data on mount.
  useEffect(() => {
    if (!hydrated.current) return;
    transport.storageSave("environments", environments).catch(() => {});
  }, [environments]);

  const switchEnv = useCallback((id: string | null) => {
    setActiveEnvId(id);
    try {
      localStorage.setItem("relay.activeEnv", id == null ? "" : id);
    } catch {
      // ignore
    }
  }, []);

  const addEnv = useCallback(() => {
    const id = "env-" + Date.now();
    const env: Environment = {
      id,
      name: "New environment",
      color: "rust",
      vars: [{ id: "v" + Date.now(), key: "", value: "", secret: false }],
    };
    setEnvironments((prev) => {
      const next = [...prev, env];
      try {
        localStorage.setItem("relay.environments", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setEditEnv({ id, isNew: true });
  }, []);

  const saveEnv = useCallback(
    (updated: Environment) => {
      setEnvironments((prev) => {
        const next = prev.map((e) => (e.id === updated.id ? updated : e));
        try {
          localStorage.setItem("relay.environments", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const deleteEnv = useCallback(
    (id: string) => {
      setEnvironments((prev) => {
        // Purge this env's keychain entries (orphan-free) before dropping it.
        const target = prev.find((e) => e.id === id);
        if (target) {
          for (const v of target.vars || []) {
            if (v.secret && v.key.trim()) {
              transport.secretDelete(id, v.key).catch(() => {});
            }
          }
        }
        const next = prev.filter((e) => e.id !== id);
        try {
          localStorage.setItem("relay.environments", JSON.stringify(next));
        } catch {
          // ignore
        }
        setActiveEnvId((cur) => {
          if (cur !== id) return cur;
          const fallback = next[0] ? next[0].id : null;
          try {
            localStorage.setItem("relay.activeEnv", fallback == null ? "" : fallback);
          } catch {
            // ignore
          }
          return fallback;
        });
        return next;
      });
      setEditEnv(null);
    },
    []
  );

  // A brand-new env opened then cancelled with no real edits is discarded.
  const cancelNewEnv = useCallback(
    (id: string, isNew: boolean) => {
      if (isNew) {
        setEnvironments((prev) => {
          const e = prev.find((x) => x.id === id);
          const empty = e && e.name === "New environment" && (e.vars || []).every((v) => !v.key.trim() && !v.value.trim());
          if (!empty) return prev;
          const next = prev.filter((x) => x.id !== id);
          try {
            localStorage.setItem("relay.environments", JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
      setEditEnv(null);
    },
    []
  );

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId) || null,
    [environments, activeEnvId]
  );
  const editingEnv = useMemo(
    () => (editEnv ? environments.find((e) => e.id === editEnv.id) || null : null),
    [editEnv, environments]
  );

  return {
    environments,
    activeEnv,
    activeEnvId,
    editEnv,
    editingEnv,
    setEditEnv,
    switchEnv,
    addEnv,
    saveEnv,
    deleteEnv,
    cancelNewEnv,
    resolveEnv,
  };
}
