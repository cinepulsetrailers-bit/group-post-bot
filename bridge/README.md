# Telegram Bridge (GramJS) — Railway deploy

This is a tiny Node.js server that logs into your **personal Telegram account** via MTProto
and exposes a small HTTP API for the Lovable dashboard. It also pushes incoming replies
back to Lovable via webhook.

## 1. Get Telegram API credentials

1. Go to https://my.telegram.org/auth → log in with your phone
2. "API Development Tools" → create an app
3. Note `api_id` and `api_hash`

## 2. Generate SESSION_STRING (ONE TIME, on your PC)

```bash
cd bridge
npm install
API_ID=xxxxx API_HASH=xxxxx npm run login
```

Enter phone, OTP, 2FA password (if any). Copy the long session string at the end.

## 3. Push to GitHub

Push this `bridge/` folder to a new GitHub repo (or use the whole project — Railway only
runs from the bridge folder if you set the root directory).

## 4. Deploy on Railway

1. New Project → Deploy from GitHub → pick your repo
2. **Settings → Root Directory**: `bridge` (if you pushed the whole Lovable project)
3. **Settings → Variables** — add ALL of these:

| Name | Value |
|---|---|
| `API_ID` | from my.telegram.org |
| `API_HASH` | from my.telegram.org |
| `SESSION_STRING` | from step 2 |
| `SHARED_SECRET` | any random string (e.g. `openssl rand -hex 32`) |
| `WEBHOOK_SECRET` | another random string |
| `WEBHOOK_URL` | `https://<your-lovable-app>.lovable.app/api/public/telegram/inbound` |
| `USER_ID` | your Lovable account user id (UUID — see step 6) |

4. Railway will auto-detect Node, install, and start. Wait for "🌉 Bridge listening".
5. Copy the public URL Railway gives you (e.g. `https://tg-bridge-production.up.railway.app`).

## 5. Configure Lovable

In the Lovable app → Settings:
- **Bridge base URL**: paste Railway URL
- **Shared secret**: same as `SHARED_SECRET`
- **Webhook secret**: same as `WEBHOOK_SECRET`
- Save → go to Groups → Sync from Telegram → tumhare groups aa jayenge ✅

## 6. Where to find USER_ID

After signing up in the Lovable app, open browser DevTools → Application → Local Storage →
look for `sb-*-auth-token` → `user.id` field. Or ask in chat and I'll add a button to copy it.

## 7. Scheduled posts cron

Set up a cron at https://cron-job.org (free) to ping every 1-5 min:
```
GET https://<your-lovable-app>.lovable.app/api/public/hooks/run-scheduled
```

## Cost on Railway

This bridge uses ~30-80 MB RAM idle. With $5 free credit it runs for ~1 month easily.
