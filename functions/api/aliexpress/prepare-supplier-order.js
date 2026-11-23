import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const actor = await requireUser(request, env, ['admin']);

    const body = await request.json();
    if (!body?.orderId) return json({ error: 'orderId is required.' }, 400);

    // ── PASTE THE EXISTING "prepare-supplier-order" BRANCH LOGIC HERE ──
    // This is the branch that:
    //   - validates the local order
    //   - inserts a row into aliexpress_supplier_orders (status 'prepared')
    //   - inserts a row into aliexpress_approval_events
    //     with event = 'prepared', actor_user_id = actor.id

    return json({ error: 'prepare-supplier-order handler not implemented' }, 501);
  } catch (e) {
    return fail(e);
  }
}