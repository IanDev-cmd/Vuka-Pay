import { createPrismaClient, PrismaRepository } from "@vukapay/db";
import { PayazaClient } from "@vukapay/payaza";
import { payazaNumberToMinor, reconcile, type Currency } from "@vukapay/core";

const key = process.env.PAYAZA_PUBLIC_KEY;
if (!key || !process.env.DATABASE_URL) {
  console.error("DATABASE_URL and PAYAZA_PUBLIC_KEY are required");
  process.exit(1);
}
const repo = new PrismaRepository(createPrismaClient());
const client = new PayazaClient({
  baseUrl: process.env.PAYAZA_BASE_URL ?? "https://api.payaza.africa/live/",
  publicKey: key,
  tenant: process.env.PAYAZA_TENANT === "live" ? "live" : "test",
});
const enquiry = await client.accounts.enquiry();
const payaza = enquiry.data.map((row) => ({
  currency: row.currency as Currency,
  balanceMinor: payazaNumberToMinor(row.accountBalance, row.currency as Currency),
}));
const ledger = await repo.ledgerBalances();
const drift = reconcile({
  ledger: ledger.map((row) => ({ ...row, account: row.account as "BUYER_CLEARING" })),
  payaza,
});
console.log(JSON.stringify({ drift, payaza_currencies: payaza.map((row) => row.currency) }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
if (drift.length > 0) process.exit(2);
