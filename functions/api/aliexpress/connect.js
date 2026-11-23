import { json, randomToken, sha256, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestGet({ request, env }) {
  try {
    const actor = await requireUser(request, env, ['admin']);

    if (
      !env.ALIEXPRESS_APP_KEY ||
      !env.ALIEXPRESS_APP_SECRET ||
      !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY
    ) {
      return json(
        { error: 'AliExpress app credentials or token encryption key are not configured.' },
        503
      );
    }

    const state = randomToken(32);
    const hash = await sha256(state);
    const expires = new Date(Date.now() + 10 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    await env.DB.prepare(
      'INSERT INTO aliexpress_oauth_states(state_hash,actor_user_id,expires_at) VALUES(?,?,?)'
    )
      .bind(hash, actor.id, expires)
      .run();

    const auth = new URL('https://api-sg.aliexpress.com/oauth/authorize');
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('force_auth', 'true');
    auth.searchParams.set('redirect_uri', 'https://shop.davilanco.com/api/aliexpress/callback');
    auth.searchParams.set('client_id', env.ALIEXPRESS_APP_KEY);
    auth.searchParams.set('state', state);

    return Response.redirect(auth.toString(), 302);
  } catch (e) {
    return fail(e);
  }
}