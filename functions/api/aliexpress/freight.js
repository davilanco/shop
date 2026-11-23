import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail,
  uid
} from '../../lib/api/common.js';

import {
  aeSyncCall,
  aeData
} from '../../lib/aliexpress.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    await requireUser(request, env, ['admin']);

    const b = await body(request);
    const req = b.queryDeliveryReq || {};

    if (!req.productId || !req.selectedSkuId) {
      return json({
        error: 'Product and SKU are required for a freight quote.'
      }, 400);
    }

    const result = await aeSyncCall(
      'aliexpress.ds.freight.query',
      {
        queryDeliveryReq: {
          quantity: Math.max(
            1,
            Math.min(99, Number(req.quantity) || 1)
          ),

          shipToCountry: String(
            req.shipToCountry || 'NG'
          ).toUpperCase(),

          productId: String(req.productId),

          ...(req.provinceCode
            ? {
                province: String(req.province || ''),
                provinceCode: String(req.provinceCode)
              }
            : {}),

          ...(req.cityCode
            ? { cityCode: String(req.cityCode) }
            : {}),

          selectedSkuId: String(req.selectedSkuId),
          language: String(req.language || 'en'),
          currency: String(req.currency || 'USD'),
          locale: String(req.locale || 'en_US')
        }
      },
      env
    );

    const quote = aeData(result);

    const options =
      quote?.delivery_options ||
      quote?.result?.delivery_options ||
      [];

    const local = await env.DB.prepare(
      `SELECT product_id
       FROM aliexpress_products
       WHERE ae_product_id=?`
    )
      .bind(String(req.productId))
      .first();

    // Save freight quotes for products already imported locally.
    if (local) {
      for (const x of options) {
        await env.DB.prepare(
          `INSERT INTO aliexpress_freight_quotes(
            id,
            product_id,
            ae_sku_id,
            ship_to_country,
            logistics_service_name,
            shipping_fee,
            shipping_currency,
            min_delivery_days,
            max_delivery_days,
            raw_payload,
            expires_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            uid(),
            local.product_id,
            String(req.selectedSkuId),
            String(req.shipToCountry || 'NG'),
            String(x.company || x.code || 'AliExpress logistics'),
            Number(x.shipping_fee_cent ?? 0) / 100,
            String(x.shipping_fee_currency || req.currency || 'USD'),
            Number(x.min_delivery_days) || null,
            Number(
              x.max_delivery_days ||
              x.guaranteed_delivery_days
            ) || null,
            JSON.stringify(x).slice(0, 10000),
            new Date(
              Date.now() + 30 * 60 * 1000
            ).toISOString()
          )
          .run();
      }
    }

    return json({ quote });

  } catch (e) {
    return fail(e);
  }
}