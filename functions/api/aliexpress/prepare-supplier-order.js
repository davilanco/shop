import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail,
  uid
} from '../../lib/api/common.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const actor = await requireUser(request, env, ['admin']);
    const b = await body(request);

    const local = await env.DB.prepare(
      `SELECT *
       FROM orders
       WHERE id=?
       AND payment_status='paid'`
    )
      .bind(String(b.order_id || ''))
      .first();

    if (!local) {
      return json({
        error: 'Only a successfully paid local order can enter supplier review.'
      }, 409);
    }

    const exists = await env.DB.prepare(
      `SELECT id
       FROM aliexpress_supplier_orders
       WHERE local_order_id=?`
    )
      .bind(local.id)
      .first();

    if (exists) {
      return json({
        error: 'This local order already has a supplier-order review record.'
      }, 409);
    }

    const items = await env.DB.prepare(
      `SELECT
         oi.*,
         ap.ae_product_id,
         (
           SELECT s.ae_sku_id
           FROM aliexpress_product_skus s
           WHERE s.product_id=oi.product_id
           AND s.is_available=1
           ORDER BY s.available_stock DESC
           LIMIT 1
         ) AS ae_sku_id,
         (
           SELECT COUNT(*)
           FROM aliexpress_product_skus s
           WHERE s.product_id=oi.product_id
           AND s.is_available=1
         ) AS sku_count
       FROM order_items oi
       JOIN aliexpress_products ap
         ON ap.product_id=oi.product_id
       WHERE oi.order_id=?`
    )
      .bind(local.id)
      .all();

    if (
      !items.results.length ||
      items.results.some(
        x => !x.ae_product_id || !x.ae_sku_id
      )
    ) {
      return json({
        error: 'Every item must be linked to an AliExpress product and an available SKU before supplier review.'
      }, 409);
    }

    if (
      items.results.some(
        x => Number(x.sku_count) !== 1
      )
    ) {
      return json({
        error: 'Supplier review is paused for products with multiple available variants until the customer-selected SKU is recorded. No SKU will be guessed.'
      }, 409);
    }

    const id = uid();
    const out = 'DVL-' + crypto.randomUUID();

    // Create a review record only. This does not place an order.
    await env.DB.prepare(
      `INSERT INTO aliexpress_supplier_orders(
        id,
        local_order_id,
        out_order_id,
        status,
        payment_status,
        order_request_json
      ) VALUES(?,?,?,'awaiting_admin_approval','not_requested',?)`
    )
      .bind(
        id,
        local.id,
        out,
        JSON.stringify({
          items: items.results.map(x => ({
            ae_product_id: x.ae_product_id,
            ae_sku_id: x.ae_sku_id,
            quantity: x.quantity
          }))
        })
      )
      .run();

    for (const x of items.results) {
      await env.DB.prepare(
        `INSERT INTO aliexpress_supplier_order_items(
          id,
          supplier_order_id,
          local_order_item_id,
          ae_product_id,
          ae_sku_id,
          quantity,
          supplier_unit_price,
          supplier_currency
        ) VALUES(?,?,?,?,?,?,?,?)`
      )
        .bind(
          uid(),
          id,
          x.id,
          x.ae_product_id,
          x.ae_sku_id,
          x.quantity,
          x.unit_price,
          'NGN'
        )
        .run();
    }

    await env.DB.prepare(
      `INSERT INTO aliexpress_approval_events(
        id,
        supplier_order_id,
        actor_user_id,
        event_type,
        note
      ) VALUES(?,?,?,'prepared',?)`
    )
      .bind(
        uid(),
        id,
        actor.id,
        'Queued for admin review; no supplier order or payment was submitted.'
      )
      .run();

    return json({
      ok: true,
      id,
      status: 'awaiting_admin_approval',
      payment_status: 'not_requested'
    }, 201);

  } catch (e) {
    return fail(e);
  }
}