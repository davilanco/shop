import {
  json,
  sha256,
  clearCookie
} from '../../lib/auth.js';

import {
  fail
} from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const token = request.headers
      .get('Cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('davilanco_session='))
      ?.split('=')
      .slice(1)
      .join('=');

    if (token) {
      await env.DB
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .bind(await sha256(token))
        .run();
    }

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': clearCookie() }
    );

  } catch (error) {
    return fail(error);
  }
}