import { json, sha256Hex } from '../../lib/tokens.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ---------- 1. Check login ----------
  const session = await getSession(request, env);
  if (!session?.userId) {
    return json({ error: 'unauthorized' }, 401);
  }

  // ---------- 2. Check email verified ----------
  const user = await env.DB.prepare(
    'SELECT id, email, email_verified_at FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user) {
    return json({ error: 'user_not_found' }, 404);
  }

  if (!user.email_verified_at) {
    return json({ error: 'email_not_verified' }, 403);
  }

  // ---------- 3. Get cart from frontend ----------
  const body = await request.json().catch(() => ({}));
  const customer = body.customer || {};
  const items = body.items || [];

  if (!items.length) {
    return json({ error: 'cart_empty' }, 400);
  }

  const email = customer.email || user.email;
  if (!email) {
    return json({ error: 'email_required' }, 400);
  }

  // ---------- 4. Calculate total from DB - NEVER trust frontend price ----------
  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await env.DB.prepare(
      'SELECT id, name, price FROM products WHERE id = ?'
    ).bind(item.productId).first();

    if (!product) {
      return json({ error: `Product not found: ${item.productId}` }, 400);
    }

    const qty = Math.min(99, Math.max(1, Number(item.quantity) || 1));
    total += product.price * qty;

    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: qty,
    });
  }

  // Paystack uses kobo
  const amountKobo = Math.round(total * 100);

  // ---------- 5. Create order as pending ----------
  const reference = `DAV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const orderResult = await env.DB.prepare(
    `INSERT INTO orders (user_id, reference, email, total, status, items, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    user.id,
    reference,
    email,
    total,
    JSON.stringify(orderItems),
    new Date().toISOString()
  ).run();

  const orderId = orderResult.meta?.last_row_id;

  // ---------- 6. Call Paystack ----------
  const origin = new URL(request.url).origin;

  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      reference,
      callback_url: `${origin}/payment-success.html`,
      metadata: {
        orderId,
        userId: user.id,
        customer,
        items: orderItems,
      },
    }),
  });

  const paystackData = await paystackRes.json();

  if (!paystackData.status) {
    return json({ error: paystackData.message || 'Paystack failed' }, 400);
  }

  // ---------- 7. Return to frontend ----------
  return json({
    authorization_url: paystackData.data.authorization_url,
    reference: paystackData.data.reference,
    orderId,
  });
}

// ---------- Helpers ----------

async function getSession(request, env) {
  // Try cookie first
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/davilanco_session=([^;]+)/);
  const token = match?.[1];

  if (!token) return null;

  // If your sessions table stores sha256 of token
  const tokenHash = await sha256Hex(token);

  const session = await env.DB.prepare(
    'SELECT user_id AS userId FROM sessions WHERE token_hash = ? AND expires_at > ?'
  ).bind(tokenHash, new Date().toISOString()).first();

  return session;
}