import { json, requireUser, body } from '../../lib/auth.js';
import { fail, uid } from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const user = await requireUser(request, env);

    if (!env.PAYSTACK_SECRET_KEY) {
      return json({ error: 'Payments are not configured.' }, 503);
    }

    const data = await body(request);
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length || items.length > 30) {
      return json({ error: 'Your bag is empty or too large.' }, 400);
    }

    let total = 0;
    const lines = [];

    for (const item of items) {
      const product = await env.DB.prepare(`
        SELECT id, name, price, stock
        FROM products
        WHERE id = ? AND status = 'active'
      `).bind(item.productId).first();

      const quantity = Math.max(
        1,
        Math.min(20, Math.floor(Number(item.quantity) || 1))
      );

      if (!product || product.stock < quantity) {
        return json({
          error: 'Product unavailable or insufficient stock.'
        }, 409);
      }

      total += product.price * quantity;
      lines.push({ ...product, qty: quantity });
    }

    const customer = data.customer || {};

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || '')) ||
      !customer.name ||
      !customer.phone ||
      !customer.address
    ) {
      return json({ error: 'Complete delivery details.' }, 400);
    }

    const reference = 'DVL-' + crypto.randomUUID();
    const orderId = uid();

    await env.DB.prepare(`
      INSERT INTO orders(
        id, user_id, order_number, total, status,
        payment_status, payment_reference, customer_name,
        customer_email, customer_phone, delivery_address,
        delivery_city, delivery_state, note
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      orderId,
      user.id,
      reference,
      total,
      'pending',
      'pending',
      reference,
      String(customer.name).slice(0, 100),
      String(customer.email).slice(0, 200),
      String(customer.phone).slice(0, 40),
      String(customer.address).slice(0, 500),
      String(customer.city || '').slice(0, 100),
      String(customer.state || '').slice(0, 100),
      String(customer.note || '').slice(0, 500)
    ).run();

    for (const item of lines) {
      await env.DB.prepare(`
        INSERT INTO order_items(
          id, order_id, product_id, product_name,
          unit_price, quantity
        )
        VALUES(?,?,?,?,?,?)
      `).bind(
        uid(),
        orderId,
        item.id,
        item.name,
        item.price,
        item.qty
      ).run();
    }

    const origin = new URL(request.url).origin;

    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: customer.email,
          amount: Math.round(total * 100),
          reference,
          callback_url: new URL(
            '/payment-success.html',
            origin
          ).href,
          metadata: {
            order_id: orderId
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
      await env.DB.prepare(`
        UPDATE orders
        SET payment_status = 'failed'
        WHERE id = ?
      `).bind(orderId).run();

      return json({
        error: 'Could not initialize payment.'
      }, 502);
    }

    return json({
      authorization_url: result.data.authorization_url,
      reference
    });

  } catch (error) {
    return fail(error);
  }
}