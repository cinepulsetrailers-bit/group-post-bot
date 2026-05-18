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

// Connect in the background. Railway must receive an open HTTP port quickly;
// otherwise every /send_message request becomes a platform-level 502
// "connection refused" before our JSON error handler can respond.
let telegramReady = false;
let telegramConnecting = null;

async function connectTelegram() {
  if (telegramReady) return;
  if (telegramConnecting) return telegramConnecting;

  telegramConnecting = (async () => {
    let attempt = 1;
    while (!telegramReady) {
      try {
        if (!client.connected) await client.connect();
        const me = await client.getMe();
        console.log("✅ Telegram connected as", me.username ?? me.firstName ?? "user");
        telegramReady = true;
        await warmDialogs(true);
        return;
      } catch (e) {
        const msg = String(e?.message ?? e);
        console.error(`connect attempt ${attempt} failed:`, msg);
        if (msg.includes("AUTH_KEY_DUPLICATED")) {
          console.error("⚠️ Same SESSION_STRING is active in another Railway/container/process. Stop old deployments or generate a fresh session string.");
        }
        telegramReady = false;
        const delay = Math.min(60000, 3000 * attempt++);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  })().finally(() => {
    telegramConnecting = null;
  });

  return telegramConnecting;
}

async function ensureTelegramReady() {
  if (telegramReady && client.connected) return;
  connectTelegram();
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (telegramReady && client.connected) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Telegram bridge is still connecting. Check Railway Deploy Logs for AUTH_KEY_DUPLICATED or session errors.");
}

connectTelegram();

// Keep-alive ping so Railway doesn't idle the container
setInterval(() => {
  if (!telegramReady || !client.connected) {
    connectTelegram();
    return;
  }
  client.getMe().catch((e) => {
    console.error("keepalive getMe failed:", e?.message ?? e);
    telegramReady = false;
    connectTelegram();
  });
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

app.get("/health", (_req, res) => res.json({ ok: true, telegramReady, telegramConnected: !!client.connected }));

app.post("/list_dialogs", async (_req, res) => {
  try {
    await ensureTelegramReady();
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

// Warm dialogs cache once at boot so getInputEntity can resolve any group
// the user is a member of. We also keep our own id -> entity map because
// Telegram channel IDs arrive as -100..., while GramJS entities store raw ids.
let dialogsWarmed = false;
const dialogEntityCache = new Map();

function cacheDialogEntity(dialog) {
  const entity = dialog?.entity;
  if (!entity) return;

  const keys = new Set();
  if (dialog.id != null) keys.add(String(dialog.id));
  if (entity.id != null) {
    const rawId = String(entity.id);
    keys.add(rawId);
    if (entity.className === "Channel") keys.add(`-100${rawId}`);
    if (entity.className === "Chat") keys.add(`-${rawId}`);
  }

  for (const key of keys) dialogEntityCache.set(key, entity);
}

async function warmDialogs(force = false) {
  if (dialogsWarmed && !force) return;
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    if (force) dialogEntityCache.clear();
    for (const dialog of dialogs) cacheDialogEntity(dialog);
    dialogsWarmed = true;
    console.log(`✅ Dialogs cache warmed (${dialogEntityCache.size} ids)`);
  } catch (e) {
    console.error("warmDialogs failed:", e?.message ?? e);
  }
}
warmDialogs();

async function withTimeout(promise, label, ms = 25000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Resolve a chat id into an InputPeer. Telegram supergroup/channel IDs come
// as negative ids prefixed with -100 (e.g. -1001234567890). Avoid constructing
// InputPeerChannel with accessHash=0 because Telegram rejects it and Railway
// often surfaces the aborted request as HTTP 502.
async function resolvePeer(tg_chat_id) {
  const idStr = String(tg_chat_id).trim();
  if (!/^-?\d+$/.test(idStr)) throw new Error(`Invalid tg_chat_id: ${idStr}`);

  await ensureTelegramReady();

  await warmDialogs();

  const cachedEntity = dialogEntityCache.get(idStr);
  if (cachedEntity) return await client.getInputEntity(cachedEntity);

  try {
    return await client.getInputEntity(BigInt(idStr));
  } catch (e1) {
    console.error("getInputEntity(BigInt) failed:", e1?.message ?? e1);
  }

  await warmDialogs(true);
  const refreshedEntity = dialogEntityCache.get(idStr);
  if (refreshedEntity) return await client.getInputEntity(refreshedEntity);

  // Basic group (negative, no -100 prefix)
  if (idStr.startsWith("-")) {
    return new Api.InputPeerChat({ chatId: BigInt(idStr.slice(1)) });
  }

  throw new Error(`Chat ${idStr} not found in Telegram dialogs. Make sure this Telegram account is joined to the group, then sync groups again.`);
}

// ---------- Message queue ----------
// If Telegram isn't ready yet (cold boot, reconnecting, FLOOD_WAIT),
// instead of failing the request we push the job to an in-memory queue
// and a background worker drains it as soon as Telegram is ready again.
const messageQueue = [];
let queueSeq = 0;
let queueProcessing = false;

function enqueueJob(type, payload) {
  const job = {
    id: `q_${Date.now()}_${++queueSeq}`,
    type,
    payload,
    attempts: 0,
    enqueuedAt: Date.now(),
    lastError: null,
  };
  messageQueue.push(job);
  console.log(`📥 Queued ${type} job ${job.id} (queue size: ${messageQueue.length})`);
  processQueueSoon();
  return job;
}

function processQueueSoon() {
  setTimeout(() => { processQueue().catch((e) => console.error("queue loop error:", e)); }, 100);
}

async function executeJob(job) {
  const { type, payload } = job;
  const peer = await resolvePeer(payload.tg_chat_id);
  if (type === "send_message") {
    const sent = await withTimeout(client.sendMessage(peer, { message: payload.text }), "send_message");
    return { tg_message_id: sent.id };
  }
  if (type === "reply") {
    const sent = await withTimeout(client.sendMessage(peer, {
      message: payload.text,
      replyTo: payload.reply_to_msg_id,
    }), "reply");
    return { tg_message_id: sent.id };
  }
  if (type === "send_media") {
    const mediaResponse = await withTimeout(fetch(payload.media_url), "fetch media", 25000);
    if (!mediaResponse.ok) throw new Error(`Media download failed: ${mediaResponse.status}`);
    const buf = Buffer.from(await withTimeout(mediaResponse.arrayBuffer(), "read media", 25000));
    const sent = await withTimeout(client.sendFile(peer, { file: buf, caption: payload.caption ?? "" }), "send_media", 60000);
    return { tg_message_id: sent.id };
  }
  throw new Error(`Unknown job type: ${type}`);
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (messageQueue.length > 0) {
      if (!telegramReady || !client.connected) {
        // Try to reconnect; bail out so the keepalive / next enqueue retries.
        connectTelegram();
        return;
      }
      const job = messageQueue[0];
      job.attempts += 1;
      try {
        const result = await executeJob(job);
        console.log(`✅ Sent queued ${job.type} job ${job.id} → tg_message_id=${result.tg_message_id} (waited ${Date.now() - job.enqueuedAt}ms)`);
        messageQueue.shift();
      } catch (e) {
        const msg = String(e?.message ?? e);
        job.lastError = msg;
        console.error(`❌ Queued ${job.type} job ${job.id} attempt ${job.attempts} failed:`, msg);
        if (job.attempts >= 5) {
          console.error(`💀 Dropping job ${job.id} after ${job.attempts} attempts`);
          messageQueue.shift();
        } else {
          // backoff before retrying
          const delay = Math.min(60000, 2000 * job.attempts);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
  } finally {
    queueProcessing = false;
  }
}

// Background drainer — runs every 5s in case a job was added while
// Telegram was down and connectTelegram() only succeeded later.
setInterval(() => {
  if (messageQueue.length > 0 && telegramReady && client.connected) {
    processQueue().catch((e) => console.error("queue loop error:", e));
  }
}, 5000);

async function handleSendRequest(type, req, res) {
  // Fast path: Telegram already ready → send synchronously and return tg_message_id.
  if (telegramReady && client.connected) {
    try {
      const result = await executeJob({ type, payload: req.body });
      return res.json(result);
    } catch (e) {
      const msg = String(e?.message ?? e);
      console.error(`${type} sync error:`, msg);
      // If Telegram dropped mid-call, fall through to queue.
      if (telegramReady && client.connected) {
        return res.status(500).json({ error: msg });
      }
    }
  }
  // Slow path: queue it and tell the caller it's pending.
  const job = enqueueJob(type, req.body);
  res.status(202).json({
    queued: true,
    queue_id: job.id,
    queue_size: messageQueue.length,
    message: "Telegram bridge not ready yet — message queued and will send automatically.",
  });
}

app.post("/send_message", (req, res) => handleSendRequest("send_message", req, res));
app.post("/send_media",   (req, res) => handleSendRequest("send_media",   req, res));
app.post("/reply",        (req, res) => handleSendRequest("reply",        req, res));

app.get("/queue_status", (_req, res) => {
  res.json({
    size: messageQueue.length,
    telegramReady,
    telegramConnected: !!client.connected,
    jobs: messageQueue.map((j) => ({
      id: j.id, type: j.type, attempts: j.attempts,
      enqueuedAt: j.enqueuedAt, lastError: j.lastError,
    })),
  });
});

app.listen(PORT, () => console.log(`🌉 Bridge listening on :${PORT}`));
