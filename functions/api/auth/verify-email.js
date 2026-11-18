import { sha256Hex, json } from '../../_lib/tokens.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const raw = typeof body?.token === 'string' ? body.token : '';
  if (raw.length < 40 || raw.length > 200) {
    return json({ error: 'invalid_token' }, 400);
  }

  const hash = await sha256Hex(raw);
  const now = Math.floor(Date.now() / 1000);

  const user = await env.DB.prepare(
    `SELECT id, email_verified_at, verification_expires_at
       FROM users WHERE verification_token_hash = ?`
  ).bind(hash).first();

  if (!user) return json({ error: 'invalid_token' }, 400);
  if (user.email_verified_at) return json({ ok: true, already_verified: true });

  if (!user.verification_expires_at || user.verification_expires_at < now) {
    await env.DB.prepare(
      `UPDATE users
          SET verification_token_hash = NULL,
              verification_expires_at = NULL
        WHERE id = ?`
    ).bind(user.id).run();
    return json({ error: 'expired' }, 410);
  }

  await env.DB.prepare(
    `UPDATE users
        SET email_verified_at = ?,
            verification_token_hash = NULL,
            verification_expires_at = NULL,
            verification_sent_at = NULL
      WHERE id = ?`
  ).bind(now, user.id).run();

  return json({ ok: true });
}