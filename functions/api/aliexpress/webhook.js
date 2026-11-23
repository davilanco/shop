import { json } from '../../lib/auth.js';

async function hmacSha256Hex(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message)
  );

  return [...new Uint8Array(signature)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    if (
      !env.ALIEXPRESS_APP_KEY ||
      !env.ALIEXPRESS_APP_SECRET
    ) {
      return json({
        error: 'AliExpress webhook credentials are not configured.'
      }, 503);
    }

    // Limit incoming payload size.
    const contentLength = Number(
      request.headers.get('content-length') || 0
    );

    if (contentLength > 262144) {
      return json({ error: 'Webhook payload too large.' }, 413);
    }

    // Read the exact original body. Do not parse and reserialize it
    // before signature verification.
    const rawBody = await request.text();

    if (!rawBody || rawBody.length > 262144) {
      return json({ error: 'Invalid webhook payload.' }, 400);
    }

    const authorization = String(
      request.headers.get('authorization') || ''
    ).trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(authorization)) {
      return json({ error: 'Invalid webhook authorization.' }, 401);
    }

    // AliExpress signature:
    // HEX(HMAC-SHA256(AppKey + raw body, AppSecret))
    const expected = await hmacSha256Hex(
      env.ALIEXPRESS_APP_KEY + rawBody,
      env.ALIEXPRESS_APP_SECRET
    );

    if (!safeEqual(authorization, expected)) {
      return json({ error: 'Webhook signature verification failed.' }, 401);
    }

    let message;

    try {
      message = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Invalid webhook JSON.' }, 400);
    }

    const messageType = Number(message?.message_type);

    if (
      !Number.isInteger(messageType) ||
      messageType < 0 ||
      !message.data ||
      typeof message.data !== 'object'
    ) {
      return json({ error: 'Invalid AliExpress message structure.' }, 400);
    }

    // Hash the exact payload for duplicate detection.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rawBody)
    );

    const idempotencyKey = [...new Uint8Array(digest)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');

    // Queue only. No supplier order or payment is submitted here.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO aliexpress_webhook_messages(
        idempotency_key,
        message_type,
        seller_id,
        trade_order_id,
        payload_json,
        status
      ) VALUES(?,?,?,?,?,'pending')`
    )
      .bind(
        idempotencyKey,
        messageType,
        String(message.seller_id || ''),
        String(message.data.trade_order_id || ''),
        rawBody
      )
      .run();

    // A duplicate notification is also acknowledged successfully.
    return new Response('OK', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    // A failed database write must not be acknowledged as successful.
    console.error('AliExpress webhook error:', error);

    return json({
      error: 'Webhook could not be stored.'
    }, 500);
  }
}