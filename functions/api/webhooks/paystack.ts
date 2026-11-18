import { verifyPaystackSignature } from "../../lib/verify-paystack";

interface Env {
  PAYSTACK_SECRET_KEY: string;
  DB: D1Database;
}

interface OrderRow {
  id: string;
  total: number;
  payment_status: string;
}

async function hashBody(body: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // --- 1. Signature verification (Step 2) ---
  const signature = request.headers.get("x-paystack-signature");
  if (!signature) {
    return new Response("No signature provided", { status: 401 });
  }
  const rawBody = await request.text();
  const isValid = await verifyPaystackSignature(
    rawBody,
    signature,
    env.PAYSTACK_SECRET_KEY
  );
  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event;

  // ============ charge.success: dedicated flow ============
  if (eventType === "charge.success") {
    const data = event.data;

    // 1. Validate required fields
    if (
      typeof data?.reference !== "string" ||
      typeof data?.amount !== "number" ||
      typeof data?.currency !== "string" ||
      data?.status !== "success"
    ) {
      console.error("Invalid charge.success payload", {
        reference: data?.reference,
      });
      return new Response(JSON.stringify({ status: "invalid_payload" }), {
        status: 200,
      });
    }

    // 2. Currency guard
    if (data.currency !== "NGN") {
      console.error("Unexpected currency", {
        reference: data.reference,
        currency: data.currency,
      });
      return new Response(JSON.stringify({ status: "currency_mismatch" }), {
        status: 200,
      });
    }

    // 3. Find the order
    const order = await env.DB.prepare(
      `SELECT id, total, payment_status FROM orders WHERE payment_reference = ?`
    )
      .bind(data.reference)
      .first<OrderRow>();

    if (!order) {
      console.error("No order for reference", { reference: data.reference });
      return new Response(JSON.stringify({ status: "order_not_found" }), {
        status: 200,
      });
    }

    // 4. Amount check (Paystack NGN is in kobo → order.total * 100)
    const expectedAmount = order.total * 100;
    if (data.amount !== expectedAmount) {
      console.error("Amount mismatch", {
        reference: data.reference,
        expected: expectedAmount,
        got: data.amount,
      });
      return new Response(JSON.stringify({ status: "amount_mismatch" }), {
        status: 200,
      });
    }

    // 5. Atomic idempotent update — succeeds only if not already paid
    const updateResult = await env.DB.prepare(
      `UPDATE orders
          SET payment_status = 'paid',
              status = 'confirmed',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND payment_status != 'paid'`
    )
      .bind(order.id)
      .run();

    if (updateResult.meta.changes === 0) {
      // Already paid → duplicate webhook, safe to ignore
      return new Response(JSON.stringify({ status: "already_paid" }), {
        status: 200,
      });
    }

    console.log("Order marked paid", {
      orderId: order.id,
      reference: data.reference,
    });
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ============ Other events: use processed_webhooks ============
  const idempotencyKey = `hash:${await hashBody(rawBody)}`;
  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_webhooks (idempotency_key, event_type) VALUES (?, ?)`
  )
    .bind(idempotencyKey, eventType)
    .run();

  if (insertResult.meta.changes === 0) {
    console.log(`Webhook ${eventType} already processed`);
    return new Response(JSON.stringify({ status: "duplicate_skipped" }), {
      status: 200,
    });
  }

  // Handle other event types here as needed (refund.processed, transfer.success, etc.)
  
  return new Response(JSON.stringify({ status: "success" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};