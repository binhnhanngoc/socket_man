// Codegen dispatch + target menus. Serializers receive skip-secret-resolved values
// (secrets stay `{{token}}`) and only format/escape — see ./types.
import { toCurl } from "./to-curl";
import { toFetch } from "./to-fetch";
import { toWscat } from "./to-wscat";
import type { CodegenHttp, CodegenWs, HttpTarget, WsTarget } from "./types";

export type { CodegenHttp, CodegenWs, HttpTarget, WsTarget } from "./types";
export { toCurl, toFetch, toWscat };

export function generateHttp(target: HttpTarget, req: CodegenHttp): string {
  return target === "curl" ? toCurl(req) : toFetch(req);
}

export function generateWs(_target: WsTarget, cfg: CodegenWs): string {
  return toWscat(cfg);
}

export const HTTP_TARGETS: { id: HttpTarget; label: string }[] = [
  { id: "curl", label: "curl" },
  { id: "fetch", label: "fetch" },
];

export const WS_TARGETS: { id: WsTarget; label: string }[] = [{ id: "wscat", label: "wscat" }];
