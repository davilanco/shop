import { json, requireUser } from '../../lib/auth.js';
import { aeRefreshIfNeeded } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestGet({ request, env }) {
  try {
    await requireUser(request, env, ['admin']);

    let c = await env.DB.prepare(
      "SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'"
    ).first();

    if (c) {
      await aeRefreshIfNeeded(env);
      c = await env.DB.prepare(
        "SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'"
      ).first();
    }

    return json({
      connected: !!c,
      access_expires_at: c?.access_expires_at || null,
      refresh_expires_at: c?.refresh_expires_at || null,
      updated_at: c?.updated_at || null,
    });
  } catch (e) {
    return fail(e);
  }
}