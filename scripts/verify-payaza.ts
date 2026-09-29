import { readFileSync, writeFileSync } from "node:fs";
import { PayazaClient } from "@vukapay/payaza";

const tenant = process.env.PAYAZA_TENANT === "live" ? "live" : "test";
const key = process.env.PAYAZA_PUBLIC_KEY;
if (!key) {
  console.error("PAYAZA_PUBLIC_KEY is not set. Refusing to claim any Payaza capability.");
  process.exit(1);
}

const client = new PayazaClient({
  baseUrl: process.env.PAYAZA_BASE_URL ?? "https://api.payaza.africa/live/",
  publicKey: key,
  tenant,
  log: (event) => console.log(JSON.stringify(event)),
});

const logPath = new URL("../docs/verification-log.json", import.meta.url);
let current: Record<string, unknown> = {};
try {
  current = JSON.parse(readFileSync(logPath, "utf8"));
} catch {
  current = {};
}

const main = await client.accounts.mainAccounts();
const enquiry = await client.accounts.enquiry();
current.account = {
  at: new Date().toISOString(),
  tenant,
  ok: true,
  currencies: enquiry.data.map((row) => row.currency),
};
writeFileSync(logPath, JSON.stringify(current, null, 2));
console.log(JSON.stringify({ ok: true, tenant, currencies: enquiry.data.map((row) => row.currency), main_type: typeof main }, null, 2));
