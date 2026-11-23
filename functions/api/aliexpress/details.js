import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

async function handler({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    await requireUser(request, env, ['admin']);

    const b = await body(request);

    // PRODUCT DETAILS
    if (b.action === 'details') {
      const productId = String(b.product_id || '').trim();

      if (!/^\d{5,30}$/.test(productId)) {
        return json({
          error: 'Enter a valid AliExpress product ID.'
        }, 400);
      }

      const result = await aeSyncCall(
        'aliexpress.ds.product.get',
        {
          ship_to_country: String(b.ship_to_country || 'NG').toUpperCase(),
          product_id: productId,
          ...(b.target_currency ? { target_currency: String(b.target_currency) } : {}),
          target_language: String(b.target_language || 'en'),
          ...(b.province_code ? { province_code: String(b.province_code) } : {}),
          ...(b.city_code ? { city_code: String(b.city_code) } : {})
        },
        env
      );

      return json({ product: aeData(result) });
    }

    return json({ error: 'Unknown AliExpress action.' }, 400);

  } catch (e) {
    return fail(e);
  }
}

export const onRequest = handler;