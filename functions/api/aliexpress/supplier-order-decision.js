import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail,
  uid
} from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const actor = await requireUser(request, env, ['admin']);
    const b = await body(request);

    const id = String(b.supplier_order_id || '');
    const decision = String(b.decision || '');
    const note = String(b.note || '').slice(0, 500);

    const row = await env.DB.prepare(
      'SELECT * FROM aliexpress_supplier_orders WHERE id=?'
    )
      .bind(id)
      .first();

    if (!row) {
      return json({
        error: 'Supplier order review record not found.'
      }, 404);
    }

    if (
      decision === 'approve' &&
      row.status === 'awaiting_admin_approval'
    ) {
      await env.DB.prepare(
        `UPDATE aliexpress_supplier_orders
         SET status='approved_for_submission',
             updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND status='awaiting_admin_approval'`
      )
        .bind(id)
        .run();

    } else if (
      decision === 'reject' &&
      row.status === 'awaiting_admin_approval'
    ) {
      await env.DB.prepare(
        `UPDATE aliexpress_supplier_orders
         SET status='rejected',
             error_message=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND status='awaiting_admin_approval'`
      )
        .bind(note || 'Rejected by admin.', id)
        .run();

    } else if (
      decision === 'approve_payment' &&
      row.status === 'approved_for_submission' &&
      row.payment_status === 'not_requested'
    ) {
      await env.DB.prepare(
        `UPDATE aliexpress_supplier_orders
         SET payment_status='approved_for_payment',
             payment_approved_by=?,
             payment_approved_at=CURRENT_TIMESTAMP,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?
         AND status='approved_for_submission'
         AND payment_status='not_requested'`
      )
        .bind(actor.id, id)
        .run();

    } else {
      return json({
        error: 'This decision is not valid for the supplier order current state.'
      }, 409);
    }

    await env.DB.prepare(
      `INSERT INTO aliexpress_approval_events(
        id,
        supplier_order_id,
        actor_user_id,
        event_type,
        note
      ) VALUES(?,?,?,?,?)`
    )
      .bind(
        uid(),
        id,
        actor.id,
        decision === 'approve'
          ? 'order_approved'
          : decision === 'reject'
            ? 'order_rejected'
            : 'payment_approved',
        note
      )
      .run();

    return json({
      ok: true,
      decision,
      warning: 'No supplier order was placed and no supplier payment was made.'
    });

  } catch (e) {
    return fail(e);
  }
}