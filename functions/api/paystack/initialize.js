export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // --- Get session (use your own session logic here) ---
  // Example: if you dey use cookie / token, get am here
  const session = await getSession(request, env);
  if (!session?.userId) {
    return json({ error: 'unauthorized' }, 401);
  }

  // --- YOUR CODE, NOW FIXED ---
  const user = await env.DB.prepare(
    'SELECT email_verified_at FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user?.email_verified_at) {
    return json({ error: 'email_not_verified' }, 403);
  }

  // --- Continue your Paystack logic below ---
  const { customer, items } = await request.json();

  // ... calculate total from DB, verify items, etc ...

  // Example return:
  return json({ authorization_url: 'https://checkout.paystack.com/...' });
}

// Helper
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Replace this with your real session function
async function getSession(request, env) {
  // TODO: return { userId: '...' } from your cookie / JWT
  return null;
}