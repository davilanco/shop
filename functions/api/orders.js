import { json, requireUser, body } from '../lib/auth.js';
import { fail } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/orders\/?/, '');
    const method = request.method;

    // GET /api/orders
    if (!path && method === 'GET') {
      const user = await requireUser(request, env, ['seller', 'admin']);

      const result = user.role === 'admin'
        ? await env.DB.prepare(`
            SELECT o.*, u.email AS customer_email
            FROM orders o
            JOIN users u ON u.id = o.user_id
            ORDER BY o.created_at DESC
            LIMIT 100
          `).all()
        : await env.DB.prepare(`
            SELECT DISTINCT o.*
            FROM orders o
            JOIN order_items i ON i.order_id = o.id
            JOIN products p ON p.id = i.product_id
            WHERE p.seller_id = ?
            ORDER BY o.created_at DESC
          `).bind(user.id).all();

      return json({ orders: result.results });
    }

    // PATCH /api/orders/status
    if (path === 'status' && method === 'PATCH') {
      const actor = await requireUser(request, env, ['admin', 'seller']);
      const data = await body(request);

      if (
        !data.orderId ||
        !['approved', 'shipping', 'delivered', 'cancelled'].includes(data.status)
      ) {
        return json({ error: 'Invalid order ID or status.' }, 400);
      }

      const order = await env.DB.prepare(
        'SELECT id FROM orders WHERE id = ?'
      ).bind(data.orderId).first();

      if (!order) {
        return json({ error: 'Order not found.' }, 404);
      }

      // Sellers may only update orders containing exclusively
      // products belonging to their own store.
      if (actor.role === 'seller') {
        const ownership = await env.DB.prepare(`
          SELECT
            COUNT(*) AS total_items,
            SUM(
              CASE WHEN p.seller_id = ? THEN 1 ELSE 0 END
            ) AS owned_items
          FROM order_items i
          LEFT JOIN products p ON p.id = i.product_id
          WHERE i.order_id = ?
        `).bind(actor.id, data.orderId).first();

        if (
          !ownership ||
          ownership.total_items === 0 ||
          ownership.owned_items !== ownership.total_items
        ) {
          return json({
            error: 'You cannot update this order because it contains products from another seller.'
          }, 403);
        }
      }

      await env.DB.prepare(`
        UPDATE orders
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(data.status, data.orderId).run();

      return json({ ok: true });
    }

    return json({ error: 'Order API endpoint not found.' }, 404);

  } catch (error) {
    return fail(error);
  }
}