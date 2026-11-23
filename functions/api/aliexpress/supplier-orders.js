import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestGet({ request, env }) {
  try {
    await requireUser(request, env, ['admin']);

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || null;
    const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200);

    // ── PASTE THE EXISTING "supplier-orders" BRANCH LOGIC HERE ──
    // Typical shape: SELECT from orders / aliexpress_supplier_orders,
    // LEFT JOIN products, filter by status if provided.

    return json({ error: 'supplier-orders handler not implemented' }, 501);
  } catch (e) {
    return fail(e);
  }
}