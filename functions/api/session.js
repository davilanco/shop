import {
  json,
  requireUser
} from '../lib/auth.js';

import {
  fail
} from '../lib/api/common.js';

export async function onRequestGet({ request, env }) {
  try {
    const user = await requireUser(request, env);

    const [orders, refs] = await Promise.all([
      env.DB
        .prepare(
          'SELECT order_number,status,total,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 30'
        )
        .bind(user.id)
        .all(),

      env.DB
        .prepare(
          'SELECT COUNT(*) n FROM users WHERE referred_by=?'
        )
        .bind(user.id)
        .first()
    ]);

    return json({
      user,
      orders: orders.results,
      referralCount: refs.n
    });

  } catch (error) {
    return fail(error);
  }
}