import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    const actor = await requireUser(request, env, ['admin']);

    const result = await env.DB.prepare(
      "DELETE FROM aliexpress_credentials WHERE id='primary'"
    ).run();

    if (!result.meta?.changes) {
      return json({ ok: true, message: 'No active AliExpress connection found.' });
    }

    return json({ ok: true, message: 'AliExpress connection removed.' });
  } catch (e) {
    return fail(e);
  }
}