import { json, requireUser, body } from '../lib/auth.js';
import { fail } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/users\/?/, '');
    const method = request.method;

    // GET /api/users
    if (!path && method === 'GET') {
      await requireUser(request, env, ['admin']);

      const result = await env.DB.prepare(`
        SELECT id, name, email, role, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 200
      `).all();

      return json({ users: result.results });
    }

    // PATCH /api/users/role
    if (path === 'role' && method === 'PATCH') {
      const admin = await requireUser(request, env, ['admin']);
      const data = await body(request);

      if (
        !data.userId ||
        !['customer', 'seller', 'admin'].includes(data.role)
      ) {
        return json({
          error: 'Valid user and role required.'
        }, 400);
      }

      const target = await env.DB.prepare(
        'SELECT id FROM users WHERE id = ?'
      ).bind(data.userId).first();

      if (!target) {
        return json({ error: 'User not found.' }, 404);
      }

      // Prevent an admin from accidentally removing their own admin access.
      if (data.userId === admin.id && data.role !== 'admin') {
        return json({
          error: 'You cannot remove your own admin role.'
        }, 403);
      }

      await env.DB.prepare(
        'UPDATE users SET role = ? WHERE id = ?'
      ).bind(data.role, data.userId).run();

      return json({ ok: true });
    }

    return json({ error: 'Users API endpoint not found.' }, 404);

  } catch (error) {
    return fail(error);
  }
}