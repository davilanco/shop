// api/orders.js
import { json, requireUser, body } from '../lib/auth.js';
import { fail } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/orders\/?/, '');
    const method = request.method;

    // ==========================================
    // GET /api/orders
    // ==========================================
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

    // ==========================================
    // POST /api/orders - CHECKOUT
    // Creates order from cart_items, then clears cart
    // Body: { customer_name, customer_email, customer_phone,
    //         delivery_address, delivery_city, delivery_state, note,
    //         payment_reference }
    // ==========================================
    if (!path && method === 'POST') {
      const user = await requireUser(request, env);
      const data = await body(request);

      const customer_name = String(data.customer_name || data.customerName || user.name || '').trim();
      const customer_email = String(data.customer_email || data.customerEmail || user.email || '').trim();
      const customer_phone = String(data.customer_phone || data.customerPhone || '').trim();
      const delivery_address = String(data.delivery_address || data.deliveryAddress || '').trim();
      const delivery_city = String(data.delivery_city || data.deliveryCity || '').trim();
      const delivery_state = String(data.delivery_state || data.deliveryState || '').trim();
      const note = String(data.note || '').slice(0, 500);
      const payment_reference = String(data.payment_reference || data.paymentReference || '').trim();

      if (!customer_name || !customer_email || !customer_phone || !delivery_address || !delivery_city || !delivery_state) {
        return json({ error: 'Name, email, phone and full delivery address are required.' }, 400);
      }
      if (!payment_reference) {
        return json({ error: 'payment_reference is required.' }, 400);
      }

      // 1. Get cart from DB (not from frontend - prevents price tampering)
      const cart = await env.DB.prepare(`
        SELECT ci.product_id, ci.quantity, p.name AS product_name, p.price, p.stock
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id = ? AND p.status = 'active'
      `).bind(user.id).all();

      const items = cart.results || [];
      if (items.length === 0) {
        return json({ error: 'Your cart is empty.' }, 400);
      }

      // 2. Validate stock + calculate total from DB price
      let total = 0;
      for (const item of items) {
        if (item.quantity > item.stock) {
          return json({ error: `Only ${item.stock} left for ${item.product_name}.` }, 400);
        }
        total += item.price * item.quantity;
      }

      const orderId = crypto.randomUUID();
      const orderNumber = 'DAV-' + Date.now().toString().slice(-8);

      // 3. Create order + items + reduce stock + clear cart in one batch
      const statements = [
        env.DB.prepare(`
          INSERT INTO orders (
            id, user_id, order_number, total, payment_status, payment_reference,
            status, customer_name, customer_email, customer_phone,
            delivery_address, delivery_city, delivery_state, note
          ) VALUES (?, ?, ?, ?, 'pending', ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          orderId, user.id, orderNumber, total, payment_reference,
          customer_name, customer_email, customer_phone,
          delivery_address, delivery_city, delivery_state, note
        ),
      ];

      for (const item of items) {
        statements.push(
          env.DB.prepare(`
            INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(crypto.randomUUID(), orderId, item.product_id, item.product_name, item.price, item.quantity)
        );
        statements.push(
          env.DB.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`)
            .bind(item.quantity, item.product_id)
        );
      }

      // Clear cart - so next device also sees empty cart after checkout
      statements.push(
        env.DB.prepare(`DELETE FROM cart_items WHERE user_id = ?`).bind(user.id)
      );

      await env.DB.batch(statements);

      return json({
        ok: true,
        order_id: orderId,
        order_number: orderNumber,
        total,
        message: 'Order created. Cart cleared.'
      }, 201);
    }

    // ==========================================
    // PATCH /api/orders/status
    // ==========================================
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