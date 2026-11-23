import {
  json,
  requireUser,
  body
} from '../../lib/auth.js';

import {
  fail,
  uid,
  amount
} from '../../lib/api/common.js';

import {
  aeSyncCall,
  aeData,
  aeProductTitle,
  aeProductImage
} from '../../lib/aliexpress.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const actor = await requireUser(request, env, ['admin']);
    const b = await body(request);

    const productId = String(b.product_id || '');
    const sellingPrice = amount(b.selling_price);

    if (!/^\d{5,30}$/.test(productId) || !sellingPrice) {
      return json({
        error: 'Valid AliExpress product ID and selling price in NGN are required.'
      }, 400);
    }

    const result = await aeSyncCall(
      'aliexpress.ds.product.get',
      {
        ship_to_country: 'NG',
        product_id: productId,
        target_currency: 'USD',
        target_language: 'en'
      },
      env
    );

    const d = aeData(result);

    const base =
      d?.ae_item_base_info_dto ||
      d?.product ||
      d?.base_info ||
      d;

    const title = aeProductTitle({
      title:
        base?.subject ||
        base?.title ||
        base?.product_title ||
        d?.title
    });

    const image =
      String(
        d?.ae_multimedia_info_dto?.image_urls || ''
      ).split(';')[0] ||
      aeProductImage({
        imageUrl:
          base?.imageUrl ||
          base?.product_main_image_url ||
          d?.imageUrl
      });

    const description = String(
      base?.detail ||
      base?.mobile_detail ||
      base?.description ||
      'Imported from AliExpress.'
    ).slice(0, 3000);

    const id = uid();

    const rawSkuList =
      d?.ae_item_sku_info_dtos ||
      d?.sku_info ||
      d?.skus ||
      [];

    const skuRows = Array.isArray(rawSkuList)
      ? rawSkuList
      : Array.isArray(rawSkuList?.ae_item_sku_info_d_t_o)
        ? rawSkuList.ae_item_sku_info_d_t_o
        : Array.isArray(rawSkuList?.ae_item_sku_info_dto)
          ? rawSkuList.ae_item_sku_info_dto
          : [];

    // Imported products remain pending until admin approval.
    await env.DB.prepare(
      `INSERT INTO products(
        id,
        seller_id,
        name,
        description,
        price,
        image,
        category,
        stock,
        status
      ) VALUES(?,?,?,?,?,?, 'imported',?, 'pending')`
    )
      .bind(
        id,
        actor.id,
        title,
        description,
        sellingPrice,
        image,
        skuRows.reduce(
          (n, s) =>
            n + Math.max(
              0,
              Number(s.sku_available_stock || 0)
            ),
          0
        )
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO aliexpress_products(
        product_id,
        ae_product_id,
        product_url,
        supplier_name,
        supplier_status,
        source_currency,
        source_price,
        source_payload,
        last_synced_at
      ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
    )
      .bind(
        id,
        productId,
        String(b.product_url || ''),
        'AliExpress',
        'active',
        'USD',
        Number(
          base?.min_price ||
          base?.price ||
          base?.sales_price ||
          0
        ) || null,
        JSON.stringify(d).slice(0, 50000)
      )
      .run();

    for (const s of skuRows) {
      const skuId = String(
        s.sku_id ??
        s.skuId ??
        s.id ??
        ''
      );

      if (!skuId) continue;

      await env.DB.prepare(
        `INSERT OR IGNORE INTO aliexpress_product_skus(
          id,
          product_id,
          ae_sku_id,
          sku_attributes,
          supplier_price,
          supplier_currency,
          available_stock,
          is_available,
          raw_payload
        ) VALUES(?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          uid(),
          id,
          skuId,
          JSON.stringify(
            s.ae_item_sku_property_dtos ||
            s.sku_attr ||
            []
          ),
          Number(
            s.offer_sale_price ||
            s.sku_price ||
            s.price ||
            0
          ) || null,
          String(s.currency || 'USD'),
          Math.max(
            0,
            Number(
              s.sku_available_stock ||
              s.stock ||
              s.inventory ||
              0
            )
          ),
          Number(
            s.sku_available_stock ||
            s.stock ||
            s.inventory ||
            0
          ) > 0 ? 1 : 0,
          JSON.stringify(s).slice(0, 10000)
        )
        .run();
    }

    return json({
      ok: true,
      product_id: id,
      status: 'pending',
      sku_count: skuRows.length,
      message: 'Imported product submitted for admin approval.'
    }, 201);

  } catch (e) {
    return fail(e);
  }
}