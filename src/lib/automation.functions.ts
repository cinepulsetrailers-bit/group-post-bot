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
    const dialogs: { chat_id: number | string; title: string; username?: string | null }[] =
      Array.isArray(raw)
        ? (raw as any)
        : Array.isArray((raw as any)?.dialogs)
          ? (raw as any).dialogs
          : Array.isArray((raw as any)?.result)
            ? (raw as any).result
            : [];
    const rows = dialogs.map((d) => ({
      user_id: context.userId,
      tg_chat_id: Number(d.chat_id),
      title: d.title ?? "Untitled",
      username: d.username ?? null,
      synced_at: new Date().toISOString(),
    }));
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

async function sendPostNow(userId: string, postId: string) {
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
    .eq("status", "pending");

  await supabaseAdmin.from("posts").update({ status: "sending" }).eq("id", postId);

  const cfg = await getBridge(userId);
  let mediaUrl: string | null = null;
  if (post.media_url) mediaUrl = await signedMediaUrl(post.media_url);

  let ok = 0;
  let fail = 0;
  for (const t of targets ?? []) {
    try {
      const payload: Record<string, unknown> = {
        chat_id: Number(t.tg_chat_id),
        text: post.body || "",
      };
      let endpoint = "/send_message";
      if (mediaUrl) {
        endpoint = "/send_media";
        payload.media_url = mediaUrl;
        payload.media_type = post.media_type ?? "auto";
        payload.caption = post.body || "";
      }
      const res = await bridgeCall<{ message_id: number }>(cfg, endpoint, payload);
      await supabaseAdmin
        .from("post_targets")
        .update({
          status: "sent",
          tg_message_id: res.message_id ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      // record outgoing message for inbox threading
      if (res.message_id) {
        await supabaseAdmin.from("messages").insert({
          user_id: userId,
          tg_chat_id: Number(t.tg_chat_id),
          tg_message_id: Number(res.message_id),
          text: post.body || null,
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
  }

  await supabaseAdmin
    .from("posts")
    .update({
      status: fail === 0 ? "sent" : ok === 0 ? "failed" : "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", postId);

  return { ok, fail };
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

    if (!isFuture) {
      const result = await sendPostNow(context.userId, post.id);
      return { id: post.id, scheduled: false, ...result };
    }
    return { id: post.id, scheduled: true, targets: targets.length };
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
      chat_id: String(data.tg_chat_id),
      text: data.text,
    };
    if (data.reply_to_tg_id != null) {
      payload.reply_to = Number(data.reply_to_tg_id);
    }
    const res = await bridgeCall<{ message_id: number }>(cfg, "/send_message", payload);
    await supabaseAdmin.from("messages").insert({
      user_id: context.userId,
      tg_chat_id: data.tg_chat_id,
      tg_message_id: Number(res.message_id),
      text: data.text,
      direction: "out",
      reply_to_tg_id: data.reply_to_tg_id ?? null,
    });
    return { ok: true, message_id: res.message_id };
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
      await sendPostNow(p.user_id, p.id);
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
