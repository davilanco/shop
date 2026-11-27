import { json } from '../../lib/auth.js';

async function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-512'
    },
    false,
    ['sign']
  );

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawBody)
  );

  const expected = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  if (signature.length !== expected.length) return false;

  let difference = 0;

  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  return difference === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.PAYSTACK_SECRET_KEY) {
      return json({ error: 'Payment configuration missing.' }, 503);
    }

    const rawBody = await request.text();

    const signature = request.headers.get('x-paystack-signature');

    const validSignature = await verifySignature(
      rawBody,
      signature,
      env.PAYSTACK_SECRET_KEY
    );

    if (!validSignature) {
      return json({ error: 'Invalid signature.' }, 401);
    }

    let event;

    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Invalid event body.' }, 400);
    }

    // We only process successful charges.
    if (event.event !== 'charge.success') {
      return json({ received: true });
    }

    const reference = String(event.data?.reference || '');

    if (!reference) {
      return json({ error: 'Missing payment reference.' }, 400);
    }

    // Find the matching local order.
    const order = await env.DB.prepare(`
      SELECT id, total, payment_status
      FROM orders
      WHERE payment_reference = ?
    `).bind(reference).first();

    if (!order) {
      return json({ error: 'Order not found.' }, 404);
    }

    // Verify directly with Paystack before changing the database.
    const response = await fetch(
      'https://api.paystack.co/transaction/verify/' +
      encodeURIComponent(reference),
      {
        headers: {
          Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY
        }
      }
    );

    const result = await response.json();

    if (
      !response.ok ||
      !result.status ||
      result.data.status !== 'success' ||
      result.data.reference !== reference ||
      result.data.amount !== Math.round(order.total * 100)
    ) {
      return json({ error: 'Payment verification failed.' }, 402);
    }

    // A unique key prevents duplicate webhook processing.
    const idempotencyKey = 'paystack:' + reference;

    const inserted = await env.DB.prepare(`
      INSERT OR IGNORE INTO processed_webhooks(
        idempotency_key,
        event_type
      )
      VALUES(?, 'charge.success')
    `).bind(idempotencyKey).run();

    if (!inserted.meta?.changes) {
      return json({
        received: true,
        duplicate: true
      });
    }

    // Update the local order.
    await env.DB.prepare(`
      UPDATE orders
      SET payment_status = 'paid',
          status = 'approved',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(order.id).run();

    return json({
      received: true,
      updated: true,
      payment_status: 'paid'
    });

  } catch (error) {
    console.error('Paystack webhook error:', error);

    return json({
      error: 'Webhook processing failed.'
    }, 500);
  }
}