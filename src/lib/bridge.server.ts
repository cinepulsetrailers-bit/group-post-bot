// Server-only helper for calling the user's external GramJS bridge.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BridgeCfg = { base_url: string; shared_secret: string; webhook_secret: string };

export async function getBridge(userId: string): Promise<BridgeCfg> {
  const { data, error } = await supabaseAdmin
    .from("bridge_config")
    .select("base_url, shared_secret, webhook_secret")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.base_url || !data.shared_secret) {
    throw new Error("Bridge not configured. Go to Settings and save your bridge URL + secret.");
  }
  return data as BridgeCfg;
}

export async function bridgeCall<T = unknown>(
  cfg: BridgeCfg,
  path: string,
  body: unknown,
): Promise<T> {
  const url = cfg.base_url.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shared-Secret": cfg.shared_secret,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed && "error" in parsed
      ? String((parsed as { error: unknown }).error)
      : text || res.statusText;
    throw new Error(`Bridge ${path} [${res.status}]: ${msg}`);
  }
  return parsed as T;
}

export async function signedMediaUrl(path: string): Promise<string | null> {
  if (!path) return null;
  // Strip bucket prefix if present
  const key = path.startsWith("media/") ? path.slice("media/".length) : path;
  const { data, error } = await supabaseAdmin.storage
    .from("media")
    .createSignedUrl(key, 60 * 60);
  if (error) throw new Error(error.message);
  return data?.signedUrl ?? null;
}
