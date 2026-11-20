import {
  json,
  hashPassword,
  randomToken,
  body
} from '../../lib/auth.js';

import {
  uid,
  session,
  fail
} from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const b = await body(request);

    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');

    if (
      name.length < 2 ||
      name.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 10 ||
      !/[0-9]/.test(password) ||
      !/[\W_]/.test(password)
    ) {
      return json(
        {
          error: 'Use a valid name/email and a password of 10+ characters with a number and symbol.'
        },
        400
      );
    }

    const existing = await env.DB
      .prepare('SELECT id FROM users WHERE email=?')
      .bind(email)
      .first();

    if (existing) {
      return json(
        { error: 'An account with this email already exists.' },
        409
      );
    }

    const hashed = await hashPassword(password);

    const referral = b.referralCode
      ? await env.DB
          .prepare('SELECT id FROM users WHERE referral_code=?')
          .bind(String(b.referralCode).slice(0, 32))
          .first()
      : null;

    const id = uid();
    const referralCode = randomToken(7).toUpperCase();

    await env.DB
      .prepare(
        'INSERT INTO users(id,name,email,password_salt,password_hash,role,referral_code,referred_by) VALUES(?,?,?,?,?,?,?,?)'
      )
      .bind(
        id,
        name,
        email,
        hashed.salt,
        hashed.hash,
        'customer',
        referralCode,
        referral?.id || null
      )
      .run();

    return await session(id, env);

  } catch (error) {
    return fail(error);
  }
}