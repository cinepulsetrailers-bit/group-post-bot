// GramJS bridge — runs on Railway. Talks to Telegram (MTProto) and to Lovable.
import express from "express";
import crypto from "node:crypto";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const {
  API_ID,
  API_HASH,
  SESSION_STRING,
  SHARED_SECRET,        // Lovable -> bridge auth
  WEBHOOK_URL,          // e.g. https://<your-app>.lovable.app/api/public/telegram/inbound
  WEBHOOK_SECRET,       // HMAC key for bridge -> Lovable
  USER_ID,              // Lovable auth user id (UUID) — sent in X-User-Id header
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({
  API_ID, API_HASH, SESSION_STRING, SHARED_SECRET, WEBHOOK_URL, WEBHOOK_SECRET, USER_ID,
})) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

// Global crash guards — without these, any unhandled async error in GramJS
// (FLOOD_WAIT, disconnect, JSON parse, etc.) kills the Railway container.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️  uncaughtException:", err);
});

const client = new TelegramClient(
  new StringSession(SESSION_STRING),
  Number(API_ID),
  API_HASH,
  {
    connectionRetries: Infinity,
    retryDelay: 3000,
    autoReconnect: true,
    floodSleepThreshold: 60,
  },
);

// Connect with retry loop so a transient Telegram outage doesn't crash boot
let connected = false;
for (let attempt = 1; attempt <= 10 && !connected; attempt++) {
  try {
    await client.connect();
    const me = await client.getMe();
    console.log("✅ Telegram connected as", me.username ?? me.firstName ?? "user");
    connected = true;
  } catch (e) {
    console.error(`connect attempt ${attempt} failed:`, e?.message ?? e);
    await new Promise((r) => setTimeout(r, Math.min(30000, 3000 * attempt)));
  }
}
if (!connected) {
  console.error("❌ Could not connect to Telegram after 10 attempts — exiting so Railway restarts");
  process.exit(1);
}

// Keep-alive ping so Railway doesn't idle the container
setInterval(() => {
  client.getMe().catch((e) => console.error("keepalive getMe failed:", e?.message ?? e));
}, 4 * 60 * 1000);

// ---------- inbound (Telegram -> Lovable) ----------
client.addEventHandler(async (event) => {
  try {
    const msg = event.message;
    if (!msg) return;
    const chat = await msg.getChat();
    const sender = await msg.getSender();

    const payload = {
      tg_chat_id: String(msg.chatId),
      tg_message_id: msg.id,
      chat_title: chat?.title ?? chat?.firstName ?? null,
      sender_id: sender?.id ? String(sender.id) : null,
      sender_name:
        sender?.username ??
        [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") ??
        null,
      text: msg.message ?? "",
      date: msg.date,
      reply_to_msg_id: msg.replyTo?.replyToMsgId ?? null,
    };

    const body = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_ID,
        "x-signature": sig,
      },
      body,
    });
    if (!r.ok) console.error("Webhook failed:", r.status, await r.text());
  } catch (e) {
    console.error("inbound error:", e);
  }
}, new NewMessage({}));

// ---------- outbound HTTP API (Lovable -> bridge) ----------
const app = express();
app.use(express.json({ limit: "20mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.headers["x-shared-secret"] !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/list_dialogs", async (_req, res) => {
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    const groups = dialogs
      .filter((d) => d.isGroup || d.isChannel)
      .map((d) => ({
        tg_chat_id: String(d.id),
        title: d.title ?? d.name ?? "Untitled",
        username: d.entity?.username ?? null,
        is_channel: !!d.isChannel,
        is_group: !!d.isGroup,
      }));
    res.json({ groups });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/send_message", async (req, res) => {
  try {
    const { tg_chat_id, text } = req.body;
    const sent = await client.sendMessage(BigInt(tg_chat_id), { message: text });
    res.json({ tg_message_id: sent.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/send_media", async (req, res) => {
  try {
    const { tg_chat_id, media_url, caption } = req.body;
    const buf = Buffer.from(await (await fetch(media_url)).arrayBuffer());
    const sent = await client.sendFile(BigInt(tg_chat_id), {
      file: buf,
      caption: caption ?? "",
    });
    res.json({ tg_message_id: sent.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post("/reply", async (req, res) => {
  try {
    const { tg_chat_id, reply_to_msg_id, text } = req.body;
    const sent = await client.sendMessage(BigInt(tg_chat_id), {
      message: text,
      replyTo: reply_to_msg_id,
    });
    res.json({ tg_message_id: sent.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.listen(PORT, () => console.log(`🌉 Bridge listening on :${PORT}`));
