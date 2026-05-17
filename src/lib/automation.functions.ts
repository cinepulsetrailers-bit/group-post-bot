import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBridge, bridgeCall, signedMediaUrl } from "./bridge.server";

// ---------- Settings ----------
export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("bridge_config")
      .select("base_url, shared_secret, webhook_secret")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data ?? { base_url: "", shared_secret: "", webhook_secret: "" };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        base_url: z.string().url().max(500),
        shared_secret: z.string().min(8).max(200),
        webhook_secret: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.from("bridge_config").upsert({
      user_id: context.userId,
      base_url: data.base_url,
      shared_secret: data.shared_secret,
      webhook_secret: data.webhook_secret,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Groups ----------
export const syncGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await getBridge(context.userId);
    const raw = await bridgeCall<unknown>(cfg, "/list_dialogs", {});
    const r = raw as any;
    const dialogs: { tg_chat_id?: number | string; chat_id?: number | string; title?: string; username?: string | null }[] =
      Array.isArray(raw)
        ? r
        : Array.isArray(r?.groups)
          ? r.groups
          : Array.isArray(r?.dialogs)
            ? r.dialogs
            : Array.isArray(r?.result)
              ? r.result
              : [];
    const rows = dialogs
      .map((d) => ({
        user_id: context.userId,
        tg_chat_id: Number(d.tg_chat_id ?? d.chat_id),
        title: d.title ?? "Untitled",
        username: d.username ?? null,
        synced_at: new Date().toISOString(),
      }))
      .filter((r) => Number.isFinite(r.tg_chat_id) && r.tg_chat_id !== 0);
    if (rows.length) {
      const { error } = await supabaseAdmin
        .from("groups")
        .upsert(rows, { onConflict: "user_id,tg_chat_id", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
    }
    return { synced: rows.length };
  });

export const listGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("groups")
      .select("*")
      .eq("user_id", context.userId)
      .order("title");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const toggleGroupSelected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_selected: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("groups")
      .update({ is_selected: data.is_selected })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const selectAllGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ value: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("groups")
      .update({ is_selected: data.value })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Posts ----------
const PostInput = z.object({
  body: z.string().max(4096),
  media_url: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  target_mode: z.enum(["all", "selected", "custom"]),
  custom_group_ids: z.array(z.string().uuid()).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
});

async function resolveTargets(
  userId: string,
  mode: "all" | "selected" | "custom",
  customIds?: string[],
) {
  let q = supabaseAdmin.from("groups").select("id, tg_chat_id").eq("user_id", userId);
  if (mode === "selected") q = q.eq("is_selected", true);
  if (mode === "custom") q = q.in("id", customIds && customIds.length ? customIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Anti-ban helpers shared by send loop
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const ZERO_WIDTH = ["\u200B", "\u200C", "\u200D", "\u2060"];
const VARY_EMOJIS = ["✨", "🔥", "💫", "⭐", "🌟", "💎", "🚀", "⚡", "💯", "🎯"];

function varyMessage(text: string): string {
  if (!text) return text;
  let out = text;
  const insertions = rand(1, 3);
  for (let n = 0; n < insertions; n++) {
    const pos = rand(0, out.length);
    const zw = ZERO_WIDTH[rand(0, ZERO_WIDTH.length - 1)];
    out = out.slice(0, pos) + zw + out.slice(pos);
  }
  const sigCount = rand(1, 2);
  const sig: string[] = [];
  const pool = [...VARY_EMOJIS];
  for (let n = 0; n < sigCount; n++) {
    const idx = rand(0, pool.length - 1);
    sig.push(pool.splice(idx, 1)[0]);
  }
  return out + "\n" + sig.join(" ");
}

// Process up to `batchSize` pending targets for a post. Designed to finish
// well within the serverFn timeout (~25s budget). Returns counts + remaining.
async function processChunk(userId: string, postId: string, batchSize: number) {
  const { data: post } = await supabaseAdmin
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();
  if (!post) throw new Error("Post not found");

  const { data: targets } = await supabaseAdmin
    .from("post_targets")
    .select("id, tg_chat_id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(batchSize);

  const targetList = targets ?? [];
  if (targetList.length === 0) {
    // Nothing left — finalize post status
    const { count: failedCount } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId)
      .eq("status", "failed");
    const { count: sentCount } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId)
      .eq("status", "sent");
    await supabaseAdmin
      .from("posts")
      .update({
        status: (sentCount ?? 0) > 0 ? "sent" : "failed",
        sent_at: new Date().toISOString(),
      })
      .eq("id", postId);
    return { processed: 0, ok: 0, fail: 0, remaining: 0 };
  }

  // Mark post as sending if not already
  if (post.status !== "sending") {
    await supabaseAdmin.from("posts").update({ status: "sending" }).eq("id", postId);
  }

  const cfg = await getBridge(userId);
  let mediaUrl: string | null = null;
  if (post.media_url) mediaUrl = await signedMediaUrl(post.media_url);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < targetList.length; i++) {
    const t = targetList[i];
    try {
      const variedText = varyMessage(post.body || "");
      const payload: Record<string, unknown> = {
        tg_chat_id: String(t.tg_chat_id),
        text: variedText,
      };
      let endpoint = "/send_message";
      if (mediaUrl) {
        endpoint = "/send_media";
        payload.media_url = mediaUrl;
        payload.media_type = post.media_type ?? "auto";
        payload.caption = variedText;
      }
      // Retry up to 3 times on transient bridge errors (502/503/504 = Railway cold start / crash)
      let res: { tg_message_id?: number; message_id?: number } | null = null;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await bridgeCall<{ tg_message_id?: number; message_id?: number }>(cfg, endpoint, payload);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          const msg = lastErr.message || "";
          const transient = /\[5(02|03|04)\]/.test(msg) || /failed to respond/i.test(msg) || /timeout/i.test(msg);
          if (!transient || attempt === 2) break;
          // exponential backoff: 4s, 8s — gives Railway time to wake up
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;
      const msgId = res?.tg_message_id ?? res?.message_id ?? null;
      await supabaseAdmin
        .from("post_targets")
        .update({
          status: "sent",
          tg_message_id: msgId,
          sent_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (msgId) {
        await supabaseAdmin.from("messages").insert({
          user_id: userId,
          tg_chat_id: Number(t.tg_chat_id),
          tg_message_id: Number(msgId),
          text: variedText,
          media_url: post.media_url ?? null,
          direction: "out",
        });
      }
      ok++;
    } catch (e) {
      fail++;
      await supabaseAdmin
        .from("post_targets")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", t.id);
    }
    // small intra-chunk delay (3-6s) — keeps chunk under ~20s for batch=2
    if (i < targetList.length - 1) {
      await new Promise((r) => setTimeout(r, rand(3000, 6000)));
    }
  }

  const { count: remaining } = await supabaseAdmin
    .from("post_targets")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("status", "pending");

  return { processed: targetList.length, ok, fail, remaining: remaining ?? 0 };
}

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PostInput.parse(d))
  .handler(async ({ data, context }) => {
    const targets = await resolveTargets(context.userId, data.target_mode, data.custom_group_ids);
    if (targets.length === 0) throw new Error("No target groups. Sync or select groups first.");

    const scheduled = data.scheduled_at ? new Date(data.scheduled_at) : null;
    const isFuture = scheduled && scheduled.getTime() > Date.now() + 5000;

    const { data: post, error } = await supabaseAdmin
      .from("posts")
      .insert({
        user_id: context.userId,
        body: data.body,
        media_url: data.media_url ?? null,
        media_type: data.media_type ?? null,
        status: isFuture ? "queued" : "sending",
        scheduled_at: scheduled?.toISOString() ?? null,
      })
      .select()
      .single();
    if (error || !post) throw new Error(error?.message ?? "Insert failed");

    const targetRows = targets.map((t) => ({
      post_id: post.id,
      user_id: context.userId,
      group_id: t.id,
      tg_chat_id: t.tg_chat_id,
      status: "pending",
    }));
    const { error: tErr } = await supabaseAdmin.from("post_targets").insert(targetRows);
    if (tErr) throw new Error(tErr.message);

    // Return immediately — client will drive sending via processPostChunk
    // to avoid Worker request timeouts on large broadcasts.
    return {
      id: post.id,
      scheduled: !!isFuture,
      targets: targets.length,
    };
  });

// Drives one chunk of pending sends. Client loops this until remaining=0.
export const processPostChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ post_id: z.string().uuid(), batch_size: z.number().int().min(1).max(5).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return processChunk(context.userId, data.post_id, data.batch_size ?? 2);
  });

// Live progress for a post
export const getPostProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ post_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { count: total } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", data.post_id)
      .eq("user_id", context.userId);
    const { count: sent } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", data.post_id)
      .eq("user_id", context.userId)
      .eq("status", "sent");
    const { count: failed } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", data.post_id)
      .eq("user_id", context.userId)
      .eq("status", "failed");
    const { count: pending } = await supabaseAdmin
      .from("post_targets")
      .select("id", { count: "exact", head: true })
      .eq("post_id", data.post_id)
      .eq("user_id", context.userId)
      .eq("status", "pending");
    return {
      total: total ?? 0,
      sent: sent ?? 0,
      failed: failed ?? 0,
      pending: pending ?? 0,
    };
  });

export const listPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("posts")
      .select("*, post_targets(count)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const cancelScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("posts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "queued");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Inbox ----------
export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markChatRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tg_chat_id: z.number() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("tg_chat_id", data.tg_chat_id)
      .eq("direction", "in")
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const replyToChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        tg_chat_id: z.number(),
        text: z.string().min(1).max(4096),
        reply_to_tg_id: z.number().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const cfg = await getBridge(context.userId);
    const payload: Record<string, unknown> = {
      tg_chat_id: String(data.tg_chat_id),
      text: data.text,
    };
    if (data.reply_to_tg_id != null) {
      payload.reply_to_msg_id = Number(data.reply_to_tg_id);
    }
    const res = await bridgeCall<{ tg_message_id?: number; message_id?: number }>(cfg, "/reply", payload);
    await supabaseAdmin.from("messages").insert({
      user_id: context.userId,
      tg_chat_id: data.tg_chat_id,
      tg_message_id: Number(res.tg_message_id ?? res.message_id),
      text: data.text,
      direction: "out",
      reply_to_tg_id: data.reply_to_tg_id ?? null,
    });
    return { ok: true, message_id: res.tg_message_id ?? res.message_id };
  });

// ---------- Internal cron-triggered runner (no auth — called by /api/public/hooks/run-scheduled) ----------
export async function runDuePostsInternal() {
  const { data: due } = await supabaseAdmin
    .from("posts")
    .select("id, user_id")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .limit(20);
  let count = 0;
  for (const p of due ?? []) {
    try {
      // Process all pending targets in chunks (cron has no Worker timeout
      // concerns because it runs as its own request and we cap loop count).
      let safety = 200;
      while (safety-- > 0) {
        const r = await processChunk(p.user_id, p.id, 2);
        if (r.remaining === 0) break;
      }
      count++;
    } catch (e) {
      await supabaseAdmin
        .from("posts")
        .update({ status: "failed" })
        .eq("id", p.id);
      console.error("Scheduled send failed", p.id, (e as Error).message);
    }
  }
  return count;
}
