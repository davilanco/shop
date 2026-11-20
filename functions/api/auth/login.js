import {
  json,
  verifyPassword,
  body
} from '../../lib/auth.js';

import {
  session,
  fail
} from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const b = await body(request);

    const user = await env.DB
      .prepare('SELECT * FROM users WHERE email=?')
      .bind(String(b.email || '').trim().toLowerCase())
      .first();

    if (
      !user ||
      !(await verifyPassword(
        String(b.password || ''),
        user.password_salt,
        user.password_hash
      ))
    ) {
      return json(
        { error: 'Email or password is incorrect.' },
        401
      );
    }

    return await session(user.id, env);

  } catch (error) {
    return fail(error);
  }
}