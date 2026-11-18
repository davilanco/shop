import { sha256Hex, generateToken, json } from '../../lib/tokens.js';
import { sendEmail, verificationEmailHtml } from '../../lib/email.js';

export async function onRequestPost({ request, env }) {
  // Adapt to your session helper — whatever your other auth endpoints use
  const session = await getSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const user = await env.DB.prepare(
    `SELECT id, email, name, email_verified_at, verification_sent_at
       FROM users WHERE id = ?`
  ).bind(session.userId).first();

  if (!user) return json({ error: 'user_not_found' }, 404);
  if (user.email_verified_at) return json({ ok: true, already_verified: true });

  const now = Math.floor(Date.now() / 1000);
  if (user.verification_sent_at && now - user.verification_sent_at < 60) {
    return json(
      { error: 'cooldown', retry_after: 60 - (now - user.verification_sent_at) },
      429
    );
  }

  const raw = generateToken();
  const hash = await sha256Hex(raw);
  const expiresAt = now + 60 * 60 * 24;

  await env.DB.prepare(
    `UPDATE users
        SET verification_token_hash = ?,
            verification_expires_at = ?,
            verification_sent_at = ?
      WHERE id = ?`
  ).bind(hash, expiresAt, now, user.id).run();

  const appUrl = env.APP_URL || new URL(request.url).origin;
  const verifyUrl = `${appUrl}/verify-email.html?token=${encodeURIComponent(raw)}`;

  try {
    await sendEmail(env, {
      to: user.email,
      subject: 'Verify your email',
      html: verificationEmailHtml({ name: user.name, verifyUrl }),
      text: `Verify your email: ${verifyUrl}`,
    });
  } catch (e) {
    console.error('send-verification failed', e);
    return json({ error: 'email_failed' }, 500);
  }

  return json({ ok: true });
}