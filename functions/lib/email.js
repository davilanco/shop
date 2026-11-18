export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    throw new Error('email_not_configured');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Shop <noreply@example.com>',
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Resend error', res.status, body);
    throw new Error('email_send_failed');
  }
  return res.json();
}

export function verificationEmailHtml({ name, verifyUrl }) {
  const display = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 16px">Verify your email</h2>
  <p>${display}</p>
  <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
  <p style="margin:24px 0">
    <a href="${verifyUrl}"
       style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">
      Verify email
    </a>
  </p>
  <p style="color:#666;font-size:13px">
    If the button doesn't work, paste this link into your browser:<br>
    <span style="word-break:break-all">${verifyUrl}</span>
  </p>
  <p style="color:#666;font-size:13px">If you didn't create an account, you can ignore this email.</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}