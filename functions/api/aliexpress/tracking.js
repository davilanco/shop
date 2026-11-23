import {
  json,
  requireUser
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    // Administrators and sellers can access tracking.
    await requireUser(request, env, ['admin', 'seller']);

    return json({
      tracking: [],
      message: 'Tracking provider not configured.'
    });

  } catch (e) {
    return fail(e);
  }
}