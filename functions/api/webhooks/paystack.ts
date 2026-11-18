// functions/api/webhooks/paystack.ts
import { verifyPaystackSignature } from "../../lib/verify-paystack";

interface Env {
  PAYSTACK_SECRET_KEY: string;
  DB: D1Database;
}

async function hashBody(body: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // 1. Get the signature from the header
  const signature = request.headers.get("x-paystack-signature");
  if (!signature) {
    return new Response("No signature provided", { status: 401 });
  }

  // 2. CRITICAL: Read the RAW body as text. Do NOT use request.json() here.
  const rawBody = await request.text();

  // 3. Verify the signature
  const isValid = await verifyPaystackSignature(
    rawBody,
    signature,
    env.PAYSTACK_SECRET_KEY
  );

  if (!isValid) {
    console.warn("Invalid Paystack webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // 4. Signature is valid. Now it's safe to parse the body.
  const event = JSON.parse(rawBody);

// 5. Determine the idempotency key
const eventType = event.event;
let idempotencyKey: string;

if (eventType === "charge.success") {
  idempotencyKey = `charge:${event.data.reference}`;
} else {
  idempotencyKey = `hash:${await hashBody(rawBody)}`;
}

// 6. Atomically claim the event (INSERT OR IGNORE)
const insertResult = await env.DB.prepare(
  `INSERT OR IGNORE INTO processed_webhooks (idempotency_key, event_type) VALUES (?, ?)`
).bind(idempotencyKey, eventType).run();

// If no row was inserted, this is a duplicate — skip processing
if (insertResult.meta.changes === 0) {
  console.log(`Webhook ${eventType} already processed (key: ${idempotencyKey})`);
  return new Response(JSON.stringify({ status: "duplicate_skipped" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// 7. New event — process your business logic here
if (eventType === "charge.success") {
  // Example: fulfillOrder(event.data.reference, event.data.customer.email);
}

// 8. Always return 200 OK immediately
return new Response(JSON.stringify({ status: "success" }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
}); };