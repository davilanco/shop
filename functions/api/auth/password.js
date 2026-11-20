import {
  json,
  hashPassword,
  verifyPassword,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail
} from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await requireUser(request, env);
    const b = await body(request);

    const old = await env.DB
      .prepare(
        'SELECT password_salt,password_hash FROM users WHERE id=?'
      )
      .bind(user.id)
      .first();

    if (
      !old ||
      !(await verifyPassword(
        String(b.currentPassword || ''),
        old.password_salt,
        old.password_hash
      ))
    ) {
      return json(
        { error: 'Current password is incorrect.' },
        400
      );
    }

    if (String(b.newPassword || '').length < 10) {
      return json(
        { error: 'New password must contain at least 10 characters.' },
        400
      );
    }

    const hashed = await hashPassword(b.newPassword);

    await env.DB.batch([
      env.DB
        .prepare(
          'UPDATE users SET password_salt=?,password_hash=? WHERE id=?'
        )
        .bind(hashed.salt, hashed.hash, user.id),

      env.DB
        .prepare('DELETE FROM sessions WHERE user_id=?')
        .bind(user.id)
    ]);

    return json({ ok: true });

  } catch (error) {
    return fail(error);
  }
}