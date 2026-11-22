import { json, requireUser } from '../lib/auth.js';
import { fail } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'GET') {
      return json({
        error: 'Analytics API endpoint not found.'
      }, 404);
    }

    // Only administrators can access store analytics.
    await requireUser(request, env, ['admin']);

    const tables = ['users', 'products', 'orders'];
    const stats = {};

    for (const table of tables) {
      const result = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table}`
      ).first();

      stats[table] = result.n;
    }

    const revenue = await env.DB.prepare(`
      SELECT COALESCE(SUM(total), 0) AS n
      FROM orders
      WHERE payment_status = 'paid'
    `).first();

    stats.revenue_ngn = revenue.n;

    return json({ stats });

  } catch (error) {
    return fail(error);
  }
}
