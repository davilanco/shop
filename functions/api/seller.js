import { json, requireUser, body } from '../lib/auth.js';
import { fail, uid } from '../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/seller\/?/, '');
    const method = request.method;

    // ==========================================
    // POST /api/seller/apply
    // Customer applies to become a seller
    // ==========================================
    if (path === 'apply' && method === 'POST') {
      const user = await requireUser(request, env);
      const data = await body(request);

      if (user.role !== 'customer') {
        return json({ error: 'This account cannot apply.' }, 400);
      }

      const businessName = String(data.businessName || '').trim().slice(0, 120);
      const details = String(data.details || '').trim().slice(0, 2000);
      const documentUrl = String(data.documentUrl || '').trim().slice(0, 1000);

      if (!businessName || !details) {
        return json({
          error: 'Business name and details are required.'
        }, 400);
      }

      await env.DB.prepare(`
        INSERT INTO seller_applications (
          id, user_id, business_name, details, document_url, status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          uid(),
          user.id,
          businessName,
          details,
          documentUrl,
          'pending'
        )
        .run();

      return json({ ok: true }, 201);
    }

    // ==========================================
    // GET /api/seller/applications
    // Admin lists pending applications
    // ==========================================
    if (path === 'applications' && method === 'GET') {
      await requireUser(request, env, ['admin']);

      const result = await env.DB.prepare(`
        SELECT
          a.*,
          u.email AS user_email
        FROM seller_applications a
        JOIN users u ON u.id = a.user_id
        WHERE a.status = 'pending'
        ORDER BY a.created_at DESC
      `).all();

      return json({ applications: result.results });
    }

    // ==========================================
    // PATCH /api/seller/applications
    // Admin approves or rejects an application
    // ==========================================
    if (path === 'applications' && method === 'PATCH') {
      await requireUser(request, env, ['admin']);
      const data = await body(request);

      const applicationId = String(data.applicationId || '');
      const status = data.status;

      if (!applicationId || !['approved', 'rejected'].includes(status)) {
        return json({ error: 'Invalid application decision.' }, 400);
      }

      const application = await env.DB.prepare(
        'SELECT user_id FROM seller_applications WHERE id = ?'
      )
        .bind(applicationId)
        .first();

      if (!application) {
        return json({ error: 'Application not found.' }, 404);
      }

      await env.DB.prepare(`
        UPDATE seller_applications
        SET status = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
        .bind(status, applicationId)
        .run();

      if (status === 'approved') {
        await env.DB.prepare(`
          UPDATE users
          SET role = 'seller'
          WHERE id = ?
        `)
          .bind(application.user_id)
          .run();
      }

      return json({ ok: true });
    }

    return json({ error: 'Seller API endpoint not found.' }, 404);
  } catch (error) {
    return fail(error);
  }
}