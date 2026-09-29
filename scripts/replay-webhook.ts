import { createPrismaClient, PrismaRepository } from "@vukapay/db";
import { VukaService } from "@vukapay/core";

const id = process.argv[2];
if (!id || !process.env.DATABASE_URL) {
  console.error("Usage: tsx scripts/replay-webhook.ts <eventId>");
  process.exit(1);
}
const prisma = createPrismaClient();
const event = await prisma.payazaEvent.findUnique({ where: { id } });
if (!event) {
  console.error("event not found");
  process.exit(1);
}
if (!event.signatureOk) {
  console.error("refusing to replay an event whose signature did not verify");
  process.exit(1);
}
console.log(JSON.stringify({ id: event.id, reference: event.transactionReference, bytes: event.rawBody.length }));
void PrismaRepository;
void VukaService;
console.log("Stored event is intact. Process it with POST /v1/admin/payaza-events/:id/replay so ledger rules stay in the service.");
