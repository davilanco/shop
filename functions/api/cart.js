// api/cart.js
import { json, requireUser, body } from '../lib/auth.js';
import { fail } from '../lib/api/common.js';

const uid = () => crypto.randomUUID();

async function getCartItems(env, userId) {
  const result = await env.DB.prepare(`
    SELECT
      ci.id AS cart_item_id,
      ci.product_id,
      ci.quantity,
      ci.created_at,
      ci.updated_at,
      p.name AS product_name,
      p.price,
      p.image,
      p.stock,
      p.status AS product_status,
      p.category
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.user_id = ?
    ORDER BY ci.updated_at DESC
  `).bind(userId).all();

  return result.results || [];
}

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/cart\/?/, '');
    const method = request.method;

    // ==========================================
    // GET /api/cart - Get logged-in user's cart
    // Works on any device - synced from D1
    // ==========================================
    if (!path && method === 'GET') {
      const user = await requireUser(request, env);

      const items = await getCartItems(env, user.id);
      const total = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
      const count = items.reduce((sum, i) => sum + i.quantity, 0);

      return json({ items, total, count });
    }

    // ==========================================
    // POST /api/cart - Add to cart
    // Body: { product_id, quantity: 1 }
    // If exists, quantity increases
    // ==========================================
    if (!path && method === 'POST') {
      const user = await requireUser(request, env);
      const data = await body(request);

      const productId = String(data.product_id || data.productId || '');
      const qty = Math.max(1, Math.floor(Number(data.quantity) || 1));

      if (!productId) {
        return json({ error: 'product_id is required.' }, 400);
      }

      const product = await env.DB.prepare(
        `SELECT id, price, stock, status FROM products WHERE id = ?`
      ).bind(productId).first();

      if (!product) {
        return json({ error: 'Product not found.' }, 404);
      }
      if (product.status !== 'active') {
        return json({ error: 'Product not available.' }, 400);
      }

      // Check total quantity won't exceed stock
      const existing = await env.DB.prepare(
        `SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?`
      ).bind(user.id, productId).first();

      const newTotalQty = (existing?.quantity || 0) + qty;
      if (newTotalQty > product.stock) {
        return json({ error: `Only ${product.stock} left in stock.` }, 400);
      }

      await env.DB.prepare(`
        INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, product_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          updated_at = CURRENT_TIMESTAMP
      `).bind(uid(), user.id, productId, qty).run();

      const items = await getCartItems(env, user.id);
      return json({ ok: true, message: 'Added to cart', items });
    }

    // ==========================================
    // POST /api/cart/merge - Merge guest cart after login
    // Body: { items: [{ product_id, quantity }] }
    // Call this once right after login
    // ==========================================
    if (path === 'merge' && method === 'POST') {
      const user = await requireUser(request, env);
      const data = await body(request);

      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        const productId = String(item.product_id || item.productId || '');
        if (!productId) continue;
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

        const product = await env.DB.prepare(
          `SELECT id, stock, status FROM products WHERE id = ?`
        ).bind(productId).first();

        if (!product || product.status !== 'active') continue;

        // Don't exceed stock when merging
        const existing = await env.DB.prepare(
          `SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?`
        ).bind(user.id, productId).first();

        const mergedQty = Math.min((existing?.quantity || 0) + qty, product.stock);
        if (mergedQty <= 0) continue;

        await env.DB.prepare(`
          INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, product_id) DO UPDATE SET
            quantity = ?,
            updated_at = CURRENT_TIMESTAMP
        `).bind(uid(), user.id, productId, qty, mergedQty).run();
      }

      const merged = await getCartItems(env, user.id);
      return json({ ok: true, message: 'Cart merged', items: merged });
    }

    // ==========================================
    // PATCH /api/cart - Set exact quantity
    // Body: { product_id, quantity: 2 }
    // quantity 0 = remove item
    // ==========================================
    if (!path && method === 'PATCH') {
      const user = await requireUser(request, env);
      const data = await body(request);

      const productId = String(data.product_id || data.productId || '');
      const quantity = Number(data.quantity);

      if (!productId || !Number.isSafeInteger(quantity) || quantity < 0) {
        return json({ error: 'product_id and valid quantity required.' }, 400);
      }

      if (quantity === 0) {
        await env.DB.prepare(
          `DELETE FROM cart_items WHERE user_id = ? AND product_id = ?`
        ).bind(user.id, productId).run();
      } else {
        // Check stock
        const product = await env.DB.prepare(
          `SELECT stock FROM products WHERE id = ?`
        ).bind(productId).first();

        if (product && quantity > product.stock) {
          return json({ error: `Only ${product.stock} left in stock.` }, 400);
        }

        const result = await env.DB.prepare(`
          UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND product_id = ?
        `).bind(quantity, user.id, productId).run();

        if (!result.meta?.changes) {
          return json({ error: 'Item not found in cart.' }, 404);
        }
      }

      const items = await getCartItems(env, user.id);
      return json({ ok: true, items });
    }

    // ==========================================
    // DELETE /api/cart?product_id=xxx - Remove one item
    // DELETE /api/cart/clear - Clear all items
    // ==========================================
    if (method === 'DELETE') {
      const user = await requireUser(request, env);

      if (path === 'clear') {
        await env.DB.prepare(
          `DELETE FROM cart_items WHERE user_id = ?`
        ).bind(user.id).run();
        return json({ ok: true, message: 'Cart cleared', items: [] });
      }

      if (!path) {
        const productId = url.searchParams.get('product_id') || url.searchParams.get('productId');
        if (!productId) {
          return json({ error: 'product_id required.' }, 400);
        }
        await env.DB.prepare(
          `DELETE FROM cart_items WHERE user_id = ? AND product_id = ?`
        ).bind(user.id, productId).run();

        const items = await getCartItems(env, user.id);
        return json({ ok: true, items });
      }
    }

    return json({ error: 'Cart API endpoint not found.' }, 404);

  } catch (error) {
    return fail(error);
  }
}