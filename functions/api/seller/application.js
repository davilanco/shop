import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail
} from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    const admin = await requireUser(request, env, ['admin']);

    // ==========================================
    // GET /api/seller/applications
    // List seller applications
    // ==========================================

    if (request.method === 'GET') {
      const result = await env.DB.prepare(`
        SELECT
          sa.id,
          sa.user_id,
          sa.business_name,
          sa.details,
          sa.document_url,
          sa.status,
          sa.created_at,
          sa.reviewed_at,
          u.name AS user_name,
          u.email AS user_email
        FROM seller_applications sa
        JOIN users u ON u.id = sa.user_id
        ORDER BY
          CASE
            WHEN sa.status = 'pending' THEN 0
            ELSE 1
          END,
          sa.created_at DESC
      `).all();

      return json({
        applications: result.results
      });
    }

    // ==========================================
    // PATCH /api/seller/applications
    // Approve or reject an application
    // ==========================================

    if (request.method === 'PATCH') {
      const data = await body(request);

      const applicationId = String(
        data.applicationId || ''
      ).trim();

      const status = String(
        data.status || ''
      ).trim();

      if (!applicationId || !['approved', 'rejected'].includes(status)) {
        return json({
          error: 'A valid application ID and decision are required.'
        }, 400);
      }

      const application = await env.DB.prepare(`
        SELECT
          id,
          user_id,
          status
        FROM seller_applications
        WHERE id = ?
      `)
        .bind(applicationId)
        .first();

      if (!application) {
        return json({
          error: 'Seller application not found.'
        }, 404);
      }

      if (application.status !== 'pending') {
        return json({
          error: 'This seller application has already been reviewed.'
        }, 409);
      }

      // Only approve/reject an application that is still pending.
      // Approval also changes the applicant's account role.
      const statements = [
        env.DB.prepare(`
          UPDATE seller_applications
          SET
            status = ?,
            reviewed_at = CURRENT_TIMESTAMP
          WHERE
            id = ?
            AND status = 'pending'
        `).bind(status, applicationId)
      ];

      if (status === 'approved') {
        statements.push(
          env.DB.prepare(`
            UPDATE users
            SET role = 'seller'
            WHERE id = ?
          `).bind(application.user_id)
        );
      }

      const results = await env.DB.batch(statements);

      if (!results[0]?.meta?.changes) {
        return json({
          error: 'This application was already reviewed. Refresh the page.'
        }, 409);
      }

      return json({
        ok: true,
        applicationId,
        status,
        userRole: status === 'approved' ? 'seller' : null
      });
    }

    return json({
      error: 'Method not allowed.'
    }, 405);

  } catch (error) {
    return fail(error);
  }
}