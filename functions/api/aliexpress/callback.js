import { json, sha256, requireUser, aeTokenRequest, aeSaveTokens } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';

    if (!/^[A-Za-z0-9_-]{32,}$/.test(state) || !code || code.length > 2048) {
      return json({ error: 'Invalid AliExpress authorization callback.' }, 400);
    }

    const actor = await requireUser(request, env, ['admin']);
    const hash = await sha256(state);

    const saved = await env.DB.prepare(
      "SELECT actor_user_id FROM aliexpress_oauth_states WHERE state_hash=? AND expires_at>datetime('now')"
    )
      .bind(hash)
      .first();

    if (!saved || saved.actor_user_id !== actor.id) {
      return json(
        {
          error:
            'Authorization state expired or does not match this admin session. Please reconnect.',
        },
        400
      );
    }

    const consumed = await env.DB.prepare(
      "DELETE FROM aliexpress_oauth_states WHERE state_hash=? AND actor_user_id=? AND expires_at>datetime('now')"
    )
      .bind(hash, actor.id)
      .run();

    if (!consumed.meta?.changes) {
      return json(
        { error: 'Authorization state has already been used. Please reconnect.' },
        400
      );
    }

    const tokens = await aeTokenRequest('/auth/token/create', { code }, env);
    await aeSaveTokens(tokens, env);

    return Response.redirect(
      new URL('/admin/?aliexpress=connected', url.origin).toString(),
      303
    );
  } catch (e) {
    return fail(e);
  }
}