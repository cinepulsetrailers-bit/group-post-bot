import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Bridge posts here for every incoming Telegram message.
// Header `X-User-Id` identifies which user owns it (your bridge runs per-user).
// Header `X-Signature` = HMAC-SHA256(body, bridge_config.webhook_secret) hex.
//
// Body shape:
// {
//   tg_chat_id: number,
//   tg_message_id: number,
//   chat_title?: string,
//   from_name?: string,
//   from_id?: number,
//   text?: string,
//   media_url?: string,
//   reply_to_tg_id?: number
// }

function safeEq(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export const Route = createFileRoute("/api/public/telegram/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = request.headers.get("x-user-id");
        const signature = request.headers.get("x-signature") ?? "";
        if (!userId) return new Response("missing user", { status: 400 });

        const body = await request.text();

        const { data: cfg } = await supabaseAdmin
          .from("bridge_config")
          .select("webhook_secret")
          .eq("user_id", userId)
          .maybeSingle();
        if (!cfg?.webhook_secret) return new Response("not configured", { status: 401 });

        const expected = createHmac("sha256", cfg.webhook_secret).update(body).digest("hex");
        if (!safeEq(signature, expected)) return new Response("bad signature", { status: 401 });

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const row = {
          user_id: userId,
          tg_chat_id: Number(payload.tg_chat_id),
          tg_message_id: Number(payload.tg_message_id),
          chat_title: (payload.chat_title as string) ?? null,
          from_name: (payload.from_name as string) ?? null,
          from_id: payload.from_id != null ? Number(payload.from_id) : null,
          text: (payload.text as string) ?? null,
          media_url: (payload.media_url as string) ?? null,
          direction: "in" as const,
          reply_to_tg_id:
            payload.reply_to_tg_id != null ? Number(payload.reply_to_tg_id) : null,
        };

        const { error } = await supabaseAdmin
          .from("messages")
          .upsert(row, { onConflict: "user_id,tg_chat_id,tg_message_id,direction" });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
