import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

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

    // GET /api/products
    // GET /api/products?mine=1
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

      return json({
        products: result.results
      });
    }

    // POST /api/products
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

      // Seller products require admin approval.
      // Admin-created products are immediately active.
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
        Number(data.stock) || 0
      );

      await env.DB.prepare(
        `INSERT INTO products(
          id,
          seller_id,
          name,
          description,
          price,
          image,
          category,
          stock,
          status
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

    // PATCH /api/products/status
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

      await env.DB.prepare(
        'UPDATE products SET status=? WHERE id=?'
      )
        .bind(data.status, data.productId)
        .run();

      return json({
        ok: true
      });
    }

    // DELETE /api/products/:id
    if (path && method === 'DELETE') {
      await requireUser(request, env, ['admin']);

      const productId = path.split('/')[0];

      await env.DB.prepare(
        'DELETE FROM products WHERE id=?'
      )
        .bind(productId)
        .run();

      return json({
        ok: true
      });
    }

    return json({
      error: 'API endpoint not found.'
    }, 404);

  } catch (error) {
    return json({
      error: error.message || 'Request failed'
    }, error.status || 500);
  }
}

export const onRequest = handler;