// Server functions for bridge status / health.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBridge } from "./bridge.server";

export type BridgeStatus = {
  ok: boolean;
  reachable: boolean;
  telegramReady: boolean;
  telegramConnected: boolean;
  queueSize?: number;
  cachedDialogs?: number;
  uptimeSeconds?: number;
  serverTime?: string;
  error?: string;
};

export const getBridgeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BridgeStatus> => {
    const { userId } = context;
    try {
      const cfg = await getBridge(userId);
      const url = cfg.base_url.replace(/\/$/, "") + "/status";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, { method: "GET", signal: ctrl.signal });
        const text = await res.text();
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(text); } catch { /* keep empty */ }
        if (!res.ok) {
          return {
            ok: false,
            reachable: true,
            telegramReady: false,
            telegramConnected: false,
            error: `Bridge /status [${res.status}]: ${text.slice(0, 200)}`,
          };
        }
        return {
          ok: true,
          reachable: true,
          telegramReady: !!body.telegramReady,
          telegramConnected: !!body.telegramConnected,
          queueSize: typeof body.queueSize === "number" ? body.queueSize : undefined,
          cachedDialogs: typeof body.cachedDialogs === "number" ? body.cachedDialogs : undefined,
          uptimeSeconds: typeof body.uptimeSeconds === "number" ? body.uptimeSeconds : undefined,
          serverTime: typeof body.serverTime === "string" ? body.serverTime : undefined,
        };
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      return {
        ok: false,
        reachable: false,
        telegramReady: false,
        telegramConnected: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
