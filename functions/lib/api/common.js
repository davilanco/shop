import {
  json,
  sha256,
  randomToken,
  cookieHeader
} from '../auth.js';

// ==========================================
// SHARED API HELPERS
// ==========================================

export const fail = (e) =>
  json(
    {
      error: e.message || 'Request failed',
      ...(e.aliexpressDiagnostic
        ? {
            aliexpress_error_code: e.aliexpressDiagnostic.code || null,
            aliexpress_sub_code: e.aliexpressDiagnostic.sub_code || null,
            aliexpress_request_id: e.aliexpressDiagnostic.request_id || null
          }
        : {})
    },
    e.status || 500
  );

export const uid = () => crypto.randomUUID();

export const amount = (n) =>
  Number.isFinite(Number(n)) && Number(n) > 0
    ? Math.round(Number(n))
    : 0;

export async function session(userId, env) {
  const token = randomToken();

  const expires = new Date(Date.now() + 7 * 864e5)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  await env.DB.prepare(
    'INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)'
  )
    .bind(uid(), userId, await sha256(token), expires)
    .run();

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': cookieHeader(token) }
  );
}