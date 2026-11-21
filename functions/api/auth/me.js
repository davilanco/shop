import { json } from '../../lib/tokens.js';
import { getSession } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const user = await env.DB.prepare(
    `SELECT id, email, name, role, email_verified_at
       FROM users WHERE id = ?`
  ).bind(session.Id).first();

  if (!user) return json({ error: 'unauthorized' }, 401);

  return json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    email_verified: !!user.email_verified_at,
  });
}