const user = await env.DB.prepare(
  'SELECT email_verified_at FROM users WHERE id = ?'
).bind(session.userId).first();
if (!user?.email_verified_at) {
  return json({ error: 'email_not_verified' }, 403);
}