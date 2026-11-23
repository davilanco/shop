import { json, requireUser } from '../../lib/auth.js';
import { fail } from '../../lib/api/common.js';
import { aeTokenRequest } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    await requireUser(request, env, ['admin']);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') || '20'), 50);

    if (!q) return json({ error: 'Query "q" is required.' }, 400);

    // ── PASTE THE EXISTING "search" BRANCH LOGIC HERE ──
    // It typically calls something like:
    //   const result = await aeTokenRequest('/products/search', { keyword: q, page, pageSize }, env);
    //   return json(result);

    return json({ error: 'search handler not implemented' }, 501);
  } catch (e) {
    return fail(e);
  }
}