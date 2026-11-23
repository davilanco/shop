import {
  json,
  requireUser,
  body
} from '../lib/auth.js';

const uid = () => crypto.randomUUID();

const amount = (n) =>
  Number.isFinite(Number(n)) && Number(n) > 0
    ? Math.round(Number(n))
    : 0;

async function handler({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/products\/?/, '');
    const method = request.method;

    // ==========================================
    // GET PRODUCTS
    // ==========================================
    if (!path && method === 'GET') {
      let user = null;

      try {
        user = await requireUser(request, env);
      } catch {}

      const mine =
        url.searchParams.get('mine') === '1' &&
        user &&
        ['seller', 'admin'].includes(user.role);

      const query = mine
        ? env.DB.prepare(
            'SELECT * FROM products WHERE seller_id=? ORDER BY created_at DESC'
          ).bind(user.id)

        : user && user.role === 'admin'
          ? env.DB.prepare(
              'SELECT id,name,description,price,image,category,stock,status FROM products ORDER BY created_at DESC'
            )

          : env.DB.prepare(
              "SELECT id,name,description,price,image,category,stock,status FROM products WHERE status='active' AND stock>0 ORDER BY created_at DESC"
            );

      const result = await query.all();

      return json({ products: result.results });
    }

    // ==========================================
    // CREATE PRODUCT
    // ==========================================
    if (!path && method === 'POST') {
      const user = await requireUser(
        request,
        env,
        ['seller', 'admin']
      );

      const data = await body(request);

      const name = String(data.name || '').trim();
      const price = amount(data.price);

      if (!name || name.length > 160 || !price) {
        return json({
          error: 'Product name and valid price required.'
        }, 400);
      }

      const id = uid();

      const status =
        user.role === 'admin' ? 'active' : 'pending';

      const category = [
        'locally-made',
        'imported',
        'others'
      ].includes(data.category)
        ? data.category
        : 'others';

      const stock = Math.max(
        0,
        Math.floor(Number(data.stock) || 0)
      );

      await env.DB.prepare(
        `INSERT INTO products(
          id, seller_id, name, description,
          price, image, category, stock, status
        ) VALUES(?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          id,
          user.id,
          name,
          String(data.description || '').slice(0, 3000),
          price,
          String(data.image || '').slice(0, 1000),
          category,
          stock,
          status
        )
        .run();

      return json({
        ok: true,
        id,
        status
      }, 201);
    }

    // ==========================================
    // ADMIN: DIRECT STOCK ADJUSTMENT
    // PATCH /api/products/stock
    // ==========================================
    if (path === 'stock' && method === 'PATCH') {
      await requireUser(request, env, ['admin']);

      const data = await body(request);

      const productId = String(data.productId || '');
      const adjustment = data.adjustment;
      const quantity = Number(data.quantity);

      if (
        !productId ||
        !['increase', 'reduce', 'set'].includes(adjustment) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        quantity > 100000000
      ) {
        return json({
          error: 'Provide a valid product, adjustment and quantity.'
        }, 400);
      }

      const product = await env.DB.prepare(
        'SELECT id, stock FROM products WHERE id=?'
      ).bind(productId).first();

      if (!product) {
        return json({ error: 'Product not found.' }, 404);
      }

      let newStock;

      if (adjustment === 'increase') {
        newStock = product.stock + quantity;
      } else if (adjustment === 'reduce') {
        newStock = product.stock - quantity;
      } else {
        newStock = quantity;
      }

      if (
        !Number.isSafeInteger(newStock) ||
        newStock < 0 ||
        newStock > 100000000
      ) {
        return json({
          error: 'Stock adjustment would produce an invalid stock quantity.'
        }, 400);
      }

      await env.DB.prepare(
        'UPDATE products SET stock=? WHERE id=?'
      ).bind(newStock, productId).run();

      return json({
        ok: true,
        previousStock: product.stock,
        stock: newStock
      });
    }

    // ==========================================
    // SELLER: REQUEST STOCK ADJUSTMENT
    // POST /api/products/stock-request
    // ==========================================
    if (path === 'stock-request' && method === 'POST') {
      const user = await requireUser(
        request,
        env,
        ['seller']
      );

      const data = await body(request);

      const productId = String(data.productId || '');
      const adjustment = data.adjustment;
      const quantity = Number(data.quantity);
      const reason = String(data.reason || '').trim();

      if (
        !productId ||
        !['increase', 'reduce'].includes(adjustment) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 100000000 ||
        reason.length < 3 ||
        reason.length > 500
      ) {
        return json({
          error: 'Provide a valid product, adjustment, quantity and reason.'
        }, 400);
      }

      const product = await env.DB.prepare(
        'SELECT id, name, stock FROM products WHERE id=? AND seller_id=?'
      ).bind(productId, user.id).first();

      if (!product) {
        return json({
          error: 'Product not found in your store.'
        }, 404);
      }

      if (product.stock <= 0 && adjustment === 'reduce') {
        return json({
          error: 'This product has no stock available to reduce.'
        }, 400);
      }

      const pending = await env.DB.prepare(
        `SELECT id FROM stock_requests
         WHERE product_id=? AND status='pending'
         LIMIT 1`
      ).bind(productId).first();

      if (pending) {
        return json({
          error: 'A pending stock request already exists for this product.'
        }, 409);
      }

      const id = uid();

      await env.DB.prepare(
        `INSERT INTO stock_requests(
          id, product_id, seller_id,
          adjustment_type, quantity, reason
        ) VALUES(?,?,?,?,?,?)`
      )
        .bind(
          id,
          productId,
          user.id,
          adjustment,
          quantity,
          reason
        )
        .run();

      return json({
        ok: true,
        requestId: id,
        status: 'pending'
      }, 201);
    }

    // ==========================================
    // VIEW STOCK REQUESTS
    // GET /api/products/stock-requests
    // ==========================================
    if (path === 'stock-requests' && method === 'GET') {
      const user = await requireUser(
        request,
        env,
        ['admin', 'seller']
      );

      const result = user.role === 'admin'
        ? await env.DB.prepare(`
            SELECT
              sr.*,
              p.name AS product_name,
              p.stock AS current_stock,
              u.name AS seller_name
            FROM stock_requests sr
            JOIN products p ON p.id = sr.product_id
            JOIN users u ON u.id = sr.seller_id
            ORDER BY
              CASE WHEN sr.status='pending' THEN 0 ELSE 1 END,
              sr.created_at DESC
          `).all()

        : await env.DB.prepare(`
            SELECT
              sr.*,
              p.name AS product_name,
              p.stock AS current_stock
            FROM stock_requests sr
            JOIN products p ON p.id = sr.product_id
            WHERE sr.seller_id=?
            ORDER BY sr.created_at DESC
          `).bind(user.id).all();

      return json({
        requests: result.results
      });
    }

    // ==========================================
    // ADMIN: APPROVE OR REJECT STOCK REQUEST
    // PATCH /api/products/stock-requests
    // ==========================================
    if (path === 'stock-requests' && method === 'PATCH') {
      const admin = await requireUser(
        request,
        env,
        ['admin']
      );

      const data = await body(request);

      const requestId = String(data.requestId || '');
      const decision = data.decision;

      if (
        !requestId ||
        !['approve', 'reject'].includes(decision)
      ) {
        return json({
          error: 'Provide a valid request ID and decision.'
        }, 400);
      }

      const stockRequest = await env.DB.prepare(`
        SELECT
          id, product_id, adjustment_type, quantity, status
        FROM stock_requests
        WHERE id=?
      `).bind(requestId).first();

      if (!stockRequest) {
        return json({
          error: 'Stock request not found.'
        }, 404);
      }

      if (stockRequest.status !== 'pending') {
        return json({
          error: 'This request has already been reviewed.'
        }, 409);
      }

      if (decision === 'reject') {
        await env.DB.prepare(`
          UPDATE stock_requests
          SET status='rejected',
              reviewed_by=?,
              reviewed_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='pending'
        `).bind(admin.id, requestId).run();

        return json({
          ok: true,
          status: 'rejected'
        });
      }

      // Approve request and adjust stock in one D1 batch.
const results = await env.DB.batch([
  env.DB.prepare(`
    UPDATE stock_requests
    SET status='approved',
        reviewed_by=?,
        reviewed_at=CURRENT_TIMESTAMP
    WHERE id=?
      AND status='pending'
      AND EXISTS (
        SELECT 1
        FROM products p
        WHERE p.id = stock_requests.product_id
          AND (
            (
              stock_requests.adjustment_type='increase'
              AND p.stock <= 100000000 - stock_requests.quantity
            )
            OR
            (
              stock_requests.adjustment_type='reduce'
              AND p.stock >= stock_requests.quantity
            )
          )
      )
  `).bind(admin.id, requestId),

  env.DB.prepare(`
    UPDATE products
    SET stock = CASE
      WHEN (
        SELECT adjustment_type
        FROM stock_requests
        WHERE id=? AND status='approved'
      ) = 'increase'
      THEN stock + (
        SELECT quantity
        FROM stock_requests
        WHERE id=? AND status='approved'
      )
      ELSE stock - (
        SELECT quantity
        FROM stock_requests
        WHERE id=? AND status='approved'
      )
    END
    WHERE id=?
      AND EXISTS (
        SELECT 1
        FROM stock_requests
        WHERE id=?
          AND status='approved'
          AND reviewed_by=?
      )
  `).bind(
    requestId,
    requestId,
    requestId,
    stockRequest.product_id,
    requestId,
    admin.id
  )
]);

if (!results[0].meta?.changes) {
  return json({
    error: 'Request is no longer pending, or the stock adjustment is invalid.'
  }, 409);
}

if (!results[1].meta?.changes) {
  return json({
    error: 'Stock update failed. Please refresh and check the request.'
  }, 409);
}

return json({
  ok: true,
  status: 'approved'
});

    // ==========================================
    // ADMIN: CHANGE PRODUCT STATUS
    // ==========================================
    if (path === 'status' && method === 'PATCH') {
      await requireUser(request, env, ['admin']);

      const data = await body(request);

      if (
        !data.productId ||
        !['active', 'rejected', 'archived', 'pending'].includes(data.status)
      ) {
        return json({
          error: 'Valid productId and status required.'
        }, 400);
      }

      const result = await env.DB.prepare(
        'UPDATE products SET status=? WHERE id=?'
      )
        .bind(data.status, data.productId)
        .run();

      if (!result.meta?.changes) {
        return json({ error: 'Product not found.' }, 404);
      }

      return json({ ok: true });
    }

    // ==========================================
    // ADMIN: DELETE PRODUCT
    // ==========================================
    if (path && method === 'DELETE') {
      await requireUser(request, env, ['admin']);

      const productId = path.split('/')[0];

      await env.DB.prepare(
        'DELETE FROM products WHERE id=?'
      )
        .bind(productId)
        .run();

      return json({ ok: true });
    }

    return json({
      error: 'API endpoint not found.'
    }, 404);

  } catch (error) {
    console.error('Products API error:', error);

    return json({
      error: error.message || 'Request failed'
    }, error.status || 500);
  }
}

export const onRequest = handler;