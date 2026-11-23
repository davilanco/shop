import {
  json,
  requireUser
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    // Only administrators can view supplier orders.
    await requireUser(request, env, ['admin']);

    const rows = await env.DB.prepare(
      `SELECT
         so.*,
         o.order_number,
         o.total AS local_total,
         o.payment_status AS local_payment_status
       FROM aliexpress_supplier_orders so
       JOIN orders o ON o.id = so.local_order_id
       ORDER BY so.created_at DESC
       LIMIT 100`
    ).all();

    return json({
      orders: rows.results
    });

  } catch (e) {
    return fail(e);
  }
}