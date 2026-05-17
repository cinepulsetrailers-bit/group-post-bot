// One-time helper: run LOCALLY on your PC to generate SESSION_STRING.
// Usage:  API_ID=xxx API_HASH=xxx node login.js
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
if (!apiId || !apiHash) {
  console.error("Set API_ID and API_HASH env vars first (from https://my.telegram.org).");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: () => input.text("Phone (+91...): "),
  password: () => input.text("2FA password (if any, else blank): "),
  phoneCode: () => input.text("Telegram OTP: "),
  onError: (e) => console.error(e),
});

console.log("\n========================================");
console.log("✅ SESSION STRING (copy & save securely):");
console.log("========================================\n");
console.log(client.session.save());
console.log("\n========================================");
console.log("Paste this as SESSION_STRING env var on Railway.");
process.exit(0);
