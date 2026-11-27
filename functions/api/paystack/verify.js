import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const user = await requireUser(request, env);

    if (!env.PAYSTACK_SECRET_KEY) {
      return json({ error: 'Payments are not configured.' }, 503);
    }

    const data = await request.json().catch(() => ({}));
    const reference = String(data.reference || '');

    if (!/^DVL-[0-9a-f-]{36}$/i.test(reference)) {
      return json({ error: 'Invalid reference.' }, 400);
    }

    const order = await env.DB.prepare(`
      SELECT *
      FROM orders
      WHERE payment_reference = ? AND user_id = ?
    `).bind(reference, user.id).first();

    if (!order) {
      return json({ error: 'Order not found.' }, 404);
    }

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
      result.data.amount !== Math.round(order.total * 100)
    ) {
      return json({
        error: 'Payment is not verified as successful.'
      }, 402);
    }

    await env.DB.prepare(`
      UPDATE orders
      SET payment_status = 'paid',
          status = 'approved',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(order.id).run();

    return json({
      ok: true,
      orderId: order.order_number,
      payment_status: 'paid'
    });

  } catch (error) {
    return fail(error);
  }
}