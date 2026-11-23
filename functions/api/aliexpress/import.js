import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';

export async function onRequestPost({ request, env }) {
  try {
    await requireUser(request, env, ['admin']);

    const body = await request.json();
    if (!body?.productId) return json({ error: 'productId is required.' }, 400);

    // ── PASTE THE EXISTING "import" BRANCH LOGIC HERE ──
    // This is the branch that inserts a row into `products`
    // with a pending/imported status and returns the new product id.

    return json({ error: 'import handler not implemented' }, 501);
  } catch (e) {
    return fail(e);
  }
}