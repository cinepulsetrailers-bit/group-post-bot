
## Goal
Telegram personal account se selected ya saare groups me post karna (text/media), schedule karna, aur incoming replies dekhkar wahin se reply karna. Personal account ka kaam Lovable ke andar nahi ho sakta (MTProto Cloudflare Workers pe support nahi hai), isliye uska ek chhota external "bridge" server aap deploy karenge — Lovable us bridge se HTTPS pe baat karega.

## Architecture
```text
[Browser UI - Lovable]
        |
        v
[Lovable Cloud DB + Server Functions] <----webhook---- [Your GramJS Bridge (VPS/Railway/Render)]
                                                              |
                                                              v
                                                       [Telegram (your personal account)]
```

- **Lovable app**: auth, dashboard, compose, schedule, inbox, settings.
- **Bridge server**: Node.js + GramJS, login with your phone + 2FA once, store session string. Exposes 4 endpoints (list_dialogs, send_message, send_media, reply) protected by a shared secret. Pushes incoming messages to Lovable webhook.

## Features (v1)
1. **Auth** (email/password) — only you log into the dashboard.
2. **Settings page** — save bridge URL + shared secret, "Sync groups" button (calls bridge → fills `groups` table).
3. **Groups** — list, toggle "selected", search.
4. **Compose** — text + optional image/file upload, choose "All groups" / "Selected" / pick specific, "Send now" or "Schedule for…".
5. **Scheduled posts** — list, edit, cancel. A cron-style server fn (or external cron hitting `/api/public/cron/run`) sends due posts.
6. **Inbox** — incoming replies grouped by chat, unread badge, reply box that calls bridge.

## Database
- `profiles` (id, email)
- `bridge_config` (id, base_url, shared_secret, webhook_secret) — single row
- `groups` (id, tg_chat_id, title, username, is_selected, synced_at)
- `posts` (id, body, media_url, status [draft/queued/sent/failed], scheduled_at, created_at)
- `post_targets` (id, post_id, group_id, tg_message_id, status, error)
- `messages` (id, tg_chat_id, tg_message_id, from_name, text, media_url, direction [in/out], reply_to_tg_id, created_at, read_at)
- Storage bucket `media` for uploads.

RLS: only `auth.uid()` rows visible (single-user app, but still scoped).

## Bridge API (I'll generate a ready-to-run repo)
- `POST /list_dialogs` → `[{ chat_id, title, username }]`
- `POST /send_message` → `{ chat_id, text, reply_to? }` → `{ message_id }`
- `POST /send_media` → multipart, returns `{ message_id }`
- Outbound webhook → `POST {LOVABLE}/api/public/telegram/inbound` with HMAC signature on every new incoming message.

All requests authenticated with `X-Shared-Secret`. Webhook signed with `webhook_secret` (HMAC-SHA256).

## What you'll need to do
1. Approve this plan.
2. After build: deploy the bridge (I'll give you the code + one-command deploy instructions for Railway/Render). Login once with phone+OTP, copy the session string into bridge env.
3. Paste bridge URL + secret into the Settings page. Click "Sync groups". Done.

## Out of scope (v1)
- Sending to channels you aren't admin in (Telegram restriction).
- Multi-user team accounts.
- Rich post editor (markdown only).

Confirm and I'll build it.
