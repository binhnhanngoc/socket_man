// Codegen input shapes. Values are TEMPLATE/skip-secret-resolved at the call site:
// non-secret {{vars}} are already expanded; secret tokens remain literal `{{token}}`.
// The serializers only format + escape — they never resolve, so a secret can never
// be expanded into a generated snippet.

export interface CodegenHttp {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CodegenWs {
  url: string;
  headers: Record<string, string>;
}

export type HttpTarget = "curl" | "fetch";
export type WsTarget = "wscat";
