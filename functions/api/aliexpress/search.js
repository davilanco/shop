import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import { fail } from '../../lib/api/common.js';

import {
  aeSyncCall,
  aeData,
  aeProducts,
  aeProductId,
  aeProductTitle,
  aeProductImage
} from '../../lib/aliexpress.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    // Only administrators can search AliExpress products.
    await requireUser(request, env, ['admin']);

    const b = await body(request);

    const keyword = String(b.keyWord || '')
      .trim()
      .slice(0, 120);

    const pageSize = Math.max(
      1,
      Math.min(50, Number(b.pageSize) || 20)
    );

    const pageIndex = Math.max(
      1,
      Number(b.pageIndex) || 1
    );

    const result = await aeSyncCall(
      'aliexpress.ds.text.search',
      {
        local: String(b.local || 'en_US').slice(0, 10),

        countryCode: String(
          b.countryCode || 'NG'
        ).slice(0, 2).toUpperCase(),

        currency: String(
          b.currency || 'USD'
        ).slice(0, 3).toUpperCase(),

        ...(keyword ? { keyWord: keyword } : {}),

        ...(b.categoryId
          ? { categoryId: String(b.categoryId) }
          : {}),

        ...(b.sortBy
          ? { sortBy: String(b.sortBy) }
          : {}),

        pageSize,
        pageIndex,

        ...(b.selectionName
          ? { selectionName: String(b.selectionName) }
          : {})
      },
      env
    );

    const d = aeData(result);
    const items = aeProducts(result);

    return json({
      products: items
        .map(x => ({
          product_id: aeProductId(x),
          title: aeProductTitle(x),
          image: aeProductImage(x),

          product_url: String(
            x.itemUrl ||
            x.productDetailUrl ||
            x.product_url ||
            ''
          ),

          price:
            x.targetSalePrice ||
            x.salePrice ||
            x.price ||
            x.minPrice ||
            '',

          orders: x.orders || x.lastest_volume || 0,

          raw: x
        }))
        .filter(x => x.product_id),

      pageIndex: d?.pageIndex || pageIndex,
      pageSize: d?.pageSize || pageSize,
      totalCount: d?.totalCount || items.length
    });

  } catch (e) {
    return fail(e);
  }
}