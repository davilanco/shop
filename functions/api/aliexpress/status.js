import {
  json,
  requireUser,
  aeRefreshIfNeeded
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    // Only administrators can view the connection status.
    await requireUser(request, env, ['admin']);

    let credentials = await env.DB.prepare(
      `SELECT
         access_expires_at,
         refresh_expires_at,
         updated_at
       FROM aliexpress_credentials
       WHERE id='primary'`
    ).first();

    // Refresh tokens when necessary before returning the status.
    if (credentials) {
      await aeRefreshIfNeeded(env);

      credentials = await env.DB.prepare(
        `SELECT
           access_expires_at,
           refresh_expires_at,
           updated_at
         FROM aliexpress_credentials
         WHERE id='primary'`
      ).first();
    }

    return json({
      connected: !!credentials,
      access_expires_at:
        credentials?.access_expires_at || null,
      refresh_expires_at:
        credentials?.refresh_expires_at || null,
      updated_at:
        credentials?.updated_at || null
    });

  } catch (e) {
    return fail(e);
  }
}