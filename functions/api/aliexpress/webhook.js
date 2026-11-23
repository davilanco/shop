import { json } from '../../lib/auth.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!env.AE_WEBHOOK_SECRET) {
    return json({ error: 'Webhook not configured.' }, 503);
  }

  if (
    request.headers.get('x-davilanco-webhook-secret') !==
    env.AE_WEBHOOK_SECRET
  ) {
    return json({ error: 'Unauthorized webhook.' }, 401);
  }

  return json({ received: true });
}