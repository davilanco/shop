// functions/api/webhooks/paystack.ts
import { verifyPaystackSignature } from "../../lib/verify-paystack";

interface Env {
  PAYSTACK_SECRET_KEY: string;
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

  // 5. Handle the event (e.g., "charge.success")
  // ... your business logic here ...

  // 6. IMPORTANT: Always return a 200 OK immediately to acknowledge receipt.
  // Paystack will retry for up to 72 hours if you don't.
  return new Response(JSON.stringify({ status: "success" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
