import { json, requireUser, body } from '../lib/auth.js';
import { fail, uid } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const method = request.method;

    // Retrieve messages (admin only)
    if (method === 'GET') {
      await requireUser(request, env, ['admin']);

      const result = await env.DB.prepare(`
        SELECT
          m.id,
          m.body,
          m.created_at,
          u.name,
          u.email
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        ORDER BY m.created_at DESC
        LIMIT 100
      `).all();

      return json({ messages: result.results });
    }

    // Send a message (logged-in users)
    if (method === 'POST') {
      const user = await requireUser(request, env);
      const data = await body(request);

      const message = String(data.body || '').trim();

      if (!message || message.length > 2000) {
        return json({
          error: 'Message must be 1–2000 characters.'
        }, 400);
      }

      await env.DB.prepare(`
        INSERT INTO messages (id, sender_id, body)
        VALUES (?, ?, ?)
      `)
        .bind(uid(), user.id, message)
        .run();

      return json({ ok: true }, 201);
    }

    return json({
      error: 'Messages API endpoint not found.'
    }, 404);

  } catch (error) {
    return fail(error);
  }
}