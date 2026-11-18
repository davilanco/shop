export async function onRequestPost({ request, env }) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400 });
    }

    // Save to D1 - make sure your binding name na DB
    // If your binding na different name, change env.DB to that name
    await env.DB.prepare(
      'INSERT OR IGNORE INTO subscribers (email) VALUES (?)'
    ).bind(email.toLowerCase().trim()).run();

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: 'Failed to subscribe' }, { status: 500 });
  }
}