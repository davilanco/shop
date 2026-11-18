export async function issueVerification(env, user) {
  const raw = generateToken();
  const hash = await sha256Hex(raw);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400;

  await env.DB.prepare(
    `UPDATE users SET verification_token_hash = ?, verification_expires_at = ?,
                      verification_sent_at = ? WHERE id = ?`
  ).bind(hash, expiresAt, now, user.id).run();

  const appUrl = env.APP_URL;
  const verifyUrl = `${appUrl}/verify-email.html?token=${encodeURIComponent(raw)}`;
  await sendEmail(env, {
    to: user.email,
    subject: 'Verify your email',
    html: verificationEmailHtml({ name: user.name, verifyUrl }),
    text: `Verify your email: ${verifyUrl}`,
  });
}