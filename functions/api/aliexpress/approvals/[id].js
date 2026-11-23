import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestPatch({ request, env, params }) {
  try {
    const actor = await requireUser(request, env, ['admin']);

    const supplierOrderId = params.id;
    if (!supplierOrderId) return json({ error: 'Missing supplier order id.' }, 400);

    const body = await request.json();
    const decision = body?.decision; // 'approve' | 'reject'
    if (!['approve', 'reject'].includes(decision)) {
      return json({ error: 'decision must be "approve" or "reject".' }, 400);
    }

    // ── PASTE THE EXISTING approve/reject BRANCH LOGIC HERE ──
    // Typical shape:
    //   UPDATE aliexpress_supplier_orders SET status = ? WHERE id = ?
    //   INSERT INTO aliexpress_approval_events
    //     (supplier_order_id, actor_user_id, event, note)
    //     VALUES (?, ?, ?, ?)   -- event = 'order_approved' | 'order_rejected'

    return json({ error: 'approvals handler not implemented' }, 501);
  } catch (e) {
    return fail(e);
  }
}