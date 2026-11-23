import {
  json,
  requireUser
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

import {
  processAliExpressWebhookBatch
} from '../../lib/aliexpress-webhooks.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({
        error: 'Method not allowed.'
      }, 405);
    }

    // Only administrators may process webhook messages.
    await requireUser(request, env, ['admin']);

    const result = await processAliExpressWebhookBatch(
      env,
      10
    );

    return json({
      ok: true,
      message: 'Webhook processing completed.',
      ...result
    });

  } catch (error) {
    console.error('AliExpress webhook processor error:', error);
    return fail(error);
  }
}