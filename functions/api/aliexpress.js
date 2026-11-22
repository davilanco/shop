import {
  json,
  sha256,
  randomToken,
  requireUser,
  body,
  aeTokenRequest,
  aeSaveTokens,
  aeRefreshIfNeeded,
  aeDecrypt,
  aeSyncSignature
} from '../lib/auth.js';

import { fail, uid, amount } from '../lib/api/common.js';

const AE_CALLBACK =
  'https://shop.davilanco.com/api/aliexpress?callback=1';

async function aeSyncCall(method, business, env) {
  const current = await aeRefreshIfNeeded(env);

  if (!current) {
    throw Object.assign(
      Error('Connect AliExpress before using supplier tools.'),
      { status: 409 }
    );
  }

  const token = await aeDecrypt(current.access_token_encrypted, env);

  const params = {
    ...business,
    app_key: env.ALIEXPRESS_APP_KEY,
    method,
    session: token,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0'
  };

  params.sign = await aeSyncSignature(
    params,
    env.ALIEXPRESS_APP_SECRET
  );

  const response = await fetch('https://api-sg.aliexpress.com/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams(
      Object.entries(params).map(([k, v]) => [
        k,
        typeof v === 'object' ? JSON.stringify(v) : String(v)
      ])
    )
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(
      Error('AliExpress returned an unreadable API response.'),
      { status: 502 }
    );
  }

  if (!response.ok) {
    throw Object.assign(
      Error('AliExpress API request failed (' + response.status + ').'),
      { status: 502 }
    );
  }

  const root =
    data?.[method.replace(/\./g, '_') + '_response'] ||
    data?.[method + '_response'] ||
    data;

  const aeError =
    root?.error_response ||
    root?.errorResponse ||
    (
      root?.code &&
      !['0', '00'].includes(String(root.code))
        ? root
        : null
    );

  if (aeError) {
    const diagnostic = {
      code: String(aeError.code ?? aeError.error_code ?? root?.code ?? ''),
      sub_code: String(
        aeError.sub_code ??
        aeError.subCode ??
        aeError.error_code ??
        ''
      ),
      request_id: String(
        aeError.request_id ??
        aeError.requestId ??
        aeError.trace_id ??
        root?.request_id ??
        root?.requestId ??
        ''
      )
    };

    const message = String(
      aeError.sub_msg ||
      aeError.subMsg ||
      aeError.msg ||
      aeError.message ||
      aeError.error_message ||
      'AliExpress rejected the request.'
    ).slice(0, 500);

    throw Object.assign(Error(message), {
      status: 502,
      aliexpressDiagnostic: diagnostic
    });
  }

  return root;
}

const aeData = x => x?.data || x?.result || x;

const aeProducts = x => {
  let d = aeData(x);

  let a =
    d?.products?.selection_search_product ||
    d?.products?.product ||
    d?.products ||
    d?.product_list?.selection_search_product ||
    d?.product_list ||
    d?.selection_search_product ||
    d?.product ||
    [];

  if (!Array.isArray(a) && a && typeof a === 'object') {
    a = Object.values(a);
  }

  if (Array.isArray(a) && a.length === 1 && Array.isArray(a[0])) {
    a = a[0];
  }

  return Array.isArray(a) ? a : [];
};

const aeProductId = x =>
  String(x?.itemId ?? x?.productId ?? x?.product_id ?? x?.item_id ?? '');

const aeProductTitle = x =>
  String(
    x?.title ??
    x?.product_title ??
    x?.subject ??
    'AliExpress product'
  ).slice(0, 160);

const aeProductImage = x =>
  String(
    x?.itemMainPic ??
    x?.imageUrl ??
    x?.image_url ??
    x?.product_main_image_url ??
    x?.image ??
    ''
  ).slice(0, 1000);

async function handler({ request, env }) {
  try {
    const url = new URL(request.url);
    const method = request.method;
    const action = url.searchParams.get('action') || '';
    const callback = url.searchParams.get('callback') === '1';

    // OAUTH CALLBACK
    if (callback && method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const code = url.searchParams.get('code') || '';

      if (
        !/^[A-Za-z0-9_-]{32,}$/.test(state) ||
        !code ||
        code.length > 2048
      ) {
        return json({
          error: 'Invalid AliExpress authorization callback.'
        }, 400);
      }

      const actor = await requireUser(request, env, ['admin']);
      const hash = await sha256(state);

      const saved = await env.DB.prepare(
        "SELECT actor_user_id FROM aliexpress_oauth_states WHERE state_hash=? AND expires_at>datetime('now')"
      )
        .bind(hash)
        .first();

      if (!saved || saved.actor_user_id !== actor.id) {
        return json({
          error: 'Authorization state expired or does not match this admin session. Please reconnect.'
        }, 400);
      }

      const consumed = await env.DB.prepare(
        "DELETE FROM aliexpress_oauth_states WHERE state_hash=? AND actor_user_id=? AND expires_at>datetime('now')"
      )
        .bind(hash, actor.id)
        .run();

      if (!consumed.meta?.changes) {
        return json({
          error: 'Authorization state has already been used. Please reconnect.'
        }, 400);
      }

      const tokens = await aeTokenRequest(
        '/auth/token/create',
        { code },
        env
      );

      await aeSaveTokens(tokens, env);

      return Response.redirect(
        new URL('/admin/?aliexpress=connected', url.origin).toString(),
        303
      );
    }

    // CONNECT
    if (action === 'connect' && method === 'GET') {
      const actor = await requireUser(request, env, ['admin']);

      if (
        !env.ALIEXPRESS_APP_KEY ||
        !env.ALIEXPRESS_APP_SECRET ||
        !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY
      ) {
        return json({
          error: 'AliExpress app credentials or token encryption key are not configured.'
        }, 503);
      }

      const state = randomToken(32);
      const hash = await sha256(state);

      const expires = new Date(Date.now() + 10 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      await env.DB.prepare(
        'INSERT INTO aliexpress_oauth_states(state_hash,actor_user_id,expires_at) VALUES(?,?,?)'
      )
        .bind(hash, actor.id, expires)
        .run();

      const auth = new URL(
        'https://api-sg.aliexpress.com/oauth/authorize'
      );

      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('force_auth', 'true');
      auth.searchParams.set('redirect_uri', AE_CALLBACK);
      auth.searchParams.set('client_id', env.ALIEXPRESS_APP_KEY);
      auth.searchParams.set('state', state);

      return Response.redirect(auth.toString(), 302);
    }

    // CONNECTION STATUS
    if (action === 'status' && method === 'GET') {
      await requireUser(request, env, ['admin']);

      let c = await env.DB.prepare(
        "SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'"
      ).first();

      if (c) {
        await aeRefreshIfNeeded(env);

        c = await env.DB.prepare(
          "SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'"
        ).first();
      }

      return json({
        connected: !!c,
        access_expires_at: c?.access_expires_at || null,
        refresh_expires_at: c?.refresh_expires_at || null,
        updated_at: c?.updated_at || null
      });
    }

    // SUPPLIER ORDER LIST
    if (action === 'supplier-orders' && method === 'GET') {
      await requireUser(request, env, ['admin']);

      const rows = await env.DB.prepare(
        "SELECT so.*,o.order_number,o.total AS local_total,o.payment_status AS local_payment_status FROM aliexpress_supplier_orders so JOIN orders o ON o.id=so.local_order_id ORDER BY so.created_at DESC LIMIT 100"
      ).all();

      return json({ orders: rows.results });
    }

    // ALIEXPRESS TRACKING
if (action === 'tracking' && method === 'GET') {
  await requireUser(request, env, ['admin', 'seller']);

  return json({
    tracking: [],
    message: 'Tracking provider not configured.'
  });
}

    if (method !== 'POST') {
      return json({ error: 'Invalid AliExpress action.' }, 404);
    }

    const actor = await requireUser(request, env, ['admin']);
    const b = await body(request);


    
    // PRODUCT SEARCH
    if (b.action === 'search') {
      const keyword = String(b.keyWord || '').trim().slice(0, 120);
      const pageSize = Math.max(1, Math.min(50, Number(b.pageSize) || 20));
      const pageIndex = Math.max(1, Number(b.pageIndex) || 1);

      const result = await aeSyncCall(
        'aliexpress.ds.text.search',
        {
          local: String(b.local || 'en_US').slice(0, 10),
          countryCode: String(b.countryCode || 'NG').slice(0, 2).toUpperCase(),
          currency: String(b.currency || 'USD').slice(0, 3).toUpperCase(),
          ...(keyword ? { keyWord: keyword } : {}),
          ...(b.categoryId ? { categoryId: String(b.categoryId) } : {}),
          ...(b.sortBy ? { sortBy: String(b.sortBy) } : {}),
          pageSize,
          pageIndex,
          ...(b.selectionName ? { selectionName: String(b.selectionName) } : {})
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
            price: x.targetSalePrice || x.salePrice || x.price || x.minPrice || '',
            orders: x.orders || x.lastest_volume || 0,
            raw: x
          }))
          .filter(x => x.product_id),

        pageIndex: d?.pageIndex || pageIndex,
        pageSize: d?.pageSize || pageSize,
        totalCount: d?.totalCount || items.length
      });
    }

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

    // FREIGHT QUOTE
    if (b.action === 'freight') {
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
            quantity: Math.max(1, Math.min(99, Number(req.quantity) || 1)),
            shipToCountry: String(req.shipToCountry || 'NG').toUpperCase(),
            productId: String(req.productId),
            ...(req.provinceCode
              ? {
                  province: String(req.province || ''),
                  provinceCode: String(req.provinceCode)
                }
              : {}),
            ...(req.cityCode ? { cityCode: String(req.cityCode) } : {}),
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
        'SELECT product_id FROM aliexpress_products WHERE ae_product_id=?'
      )
        .bind(String(req.productId))
        .first();

      if (local) {
        for (const x of options) {
          await env.DB.prepare(
            'INSERT INTO aliexpress_freight_quotes(id,product_id,ae_sku_id,ship_to_country,logistics_service_name,shipping_fee,shipping_currency,min_delivery_days,max_delivery_days,raw_payload,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
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
              Number(x.max_delivery_days || x.guaranteed_delivery_days) || null,
              JSON.stringify(x).slice(0, 10000),
              new Date(Date.now() + 30 * 60 * 1000).toISOString()
            )
            .run();
        }
      }

      return json({ quote });
    }

    // IMPORT PRODUCT
    if (b.action === 'import') {
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
        title: base?.subject || base?.title || base?.product_title || d?.title
      });

      const image =
        String(d?.ae_multimedia_info_dto?.image_urls || '').split(';')[0] ||
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

      await env.DB.prepare(
        "INSERT INTO products(id,seller_id,name,description,price,image,category,stock,status) VALUES(?,?,?,?,?,?, 'imported',?, 'pending')"
      )
        .bind(
          id,
          actor.id,
          title,
          description,
          sellingPrice,
          image,
          skuRows.reduce(
            (n, s) => n + Math.max(0, Number(s.sku_available_stock || 0)),
            0
          )
        )
        .run();

      await env.DB.prepare(
        'INSERT INTO aliexpress_products(product_id,ae_product_id,product_url,supplier_name,supplier_status,source_currency,source_price,source_payload,last_synced_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)'
      )
        .bind(
          id,
          productId,
          String(b.product_url || ''),
          'AliExpress',
          'active',
          'USD',
          Number(base?.min_price || base?.price || base?.sales_price || 0) || null,
          JSON.stringify(d).slice(0, 50000)
        )
        .run();

      for (const s of skuRows) {
        const skuId = String(s.sku_id ?? s.skuId ?? s.id ?? '');

        if (!skuId) continue;

        await env.DB.prepare(
          'INSERT OR IGNORE INTO aliexpress_product_skus(id,product_id,ae_sku_id,sku_attributes,supplier_price,supplier_currency,available_stock,is_available,raw_payload) VALUES(?,?,?,?,?,?,?,?,?)'
        )
          .bind(
            uid(),
            id,
            skuId,
            JSON.stringify(s.ae_item_sku_property_dtos || s.sku_attr || []),
            Number(s.offer_sale_price || s.sku_price || s.price || 0) || null,
            String(s.currency || 'USD'),
            Math.max(0, Number(s.sku_available_stock || s.stock || s.inventory || 0)),
            Number(s.sku_available_stock || s.stock || s.inventory || 0) > 0 ? 1 : 0,
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
    }

    // PREPARE SUPPLIER ORDER FOR ADMIN REVIEW
    if (b.action === 'prepare-supplier-order') {
      const local = await env.DB.prepare(
        "SELECT * FROM orders WHERE id=? AND payment_status='paid'"
      )
        .bind(String(b.order_id || ''))
        .first();

      if (!local) {
        return json({
          error: 'Only a successfully paid local order can enter supplier review.'
        }, 409);
      }

      const exists = await env.DB.prepare(
        'SELECT id FROM aliexpress_supplier_orders WHERE local_order_id=?'
      )
        .bind(local.id)
        .first();

      if (exists) {
        return json({
          error: 'This local order already has a supplier-order review record.'
        }, 409);
      }

      const items = await env.DB.prepare(
        'SELECT oi.*,ap.ae_product_id,(SELECT s.ae_sku_id FROM aliexpress_product_skus s WHERE s.product_id=oi.product_id AND s.is_available=1 ORDER BY s.available_stock DESC LIMIT 1) AS ae_sku_id,(SELECT COUNT(*) FROM aliexpress_product_skus s WHERE s.product_id=oi.product_id AND s.is_available=1) AS sku_count FROM order_items oi JOIN aliexpress_products ap ON ap.product_id=oi.product_id WHERE oi.order_id=?'
      )
        .bind(local.id)
        .all();

      if (
        !items.results.length ||
        items.results.some(x => !x.ae_product_id || !x.ae_sku_id)
      ) {
        return json({
          error: 'Every item must be linked to an AliExpress product and an available SKU before supplier review.'
        }, 409);
      }

      if (items.results.some(x => Number(x.sku_count) !== 1)) {
        return json({
          error: 'Supplier review is paused for products with multiple available variants until the customer-selected SKU is recorded. No SKU will be guessed.'
        }, 409);
      }

      const id = uid();
      const out = 'DVL-' + crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO aliexpress_supplier_orders(id,local_order_id,out_order_id,status,payment_status,order_request_json) VALUES(?,?,?,'awaiting_admin_approval','not_requested',?)"
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
          'INSERT INTO aliexpress_supplier_order_items(id,supplier_order_id,local_order_item_id,ae_product_id,ae_sku_id,quantity,supplier_unit_price,supplier_currency) VALUES(?,?,?,?,?,?,?,?)'
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
        "INSERT INTO aliexpress_approval_events(id,supplier_order_id,actor_user_id,event_type,note) VALUES(?,?,?,'prepared','Queued for admin review; no supplier order or payment was submitted.')"
      )
        .bind(uid(), id, actor.id)
        .run();

      return json({
        ok: true,
        id,
        status: 'awaiting_admin_approval',
        payment_status: 'not_requested'
      }, 201);
    }

    // SUPPLIER ORDER DECISION
    if (b.action === 'supplier-order-decision') {
      const id = String(b.supplier_order_id || '');
      const decision = String(b.decision || '');
      const note = String(b.note || '').slice(0, 500);

      const row = await env.DB.prepare(
        'SELECT * FROM aliexpress_supplier_orders WHERE id=?'
      )
        .bind(id)
        .first();

      if (!row) {
        return json({
          error: 'Supplier order review record not found.'
        }, 404);
      }

      if (decision === 'approve' && row.status === 'awaiting_admin_approval') {
        await env.DB.prepare(
          "UPDATE aliexpress_supplier_orders SET status='approved_for_submission',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_admin_approval'"
        )
          .bind(id)
          .run();

      } else if (
        decision === 'reject' &&
        row.status === 'awaiting_admin_approval'
      ) {
        await env.DB.prepare(
          "UPDATE aliexpress_supplier_orders SET status='rejected',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_admin_approval'"
        )
          .bind(note || 'Rejected by admin.', id)
          .run();

      } else if (
        decision === 'approve_payment' &&
        row.status === 'approved_for_submission' &&
        row.payment_status === 'not_requested'
      ) {
        await env.DB.prepare(
          "UPDATE aliexpress_supplier_orders SET payment_status='approved_for_payment',payment_approved_by=?,payment_approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved_for_submission' AND payment_status='not_requested'"
        )
          .bind(actor.id, id)
          .run();

      } else {
        return json({
          error: 'This decision is not valid for the supplier order current state.'
        }, 409);
      }

      await env.DB.prepare(
        'INSERT INTO aliexpress_approval_events(id,supplier_order_id,actor_user_id,event_type,note) VALUES(?,?,?,?,?)'
      )
        .bind(
          uid(),
          id,
          actor.id,
          decision === 'approve'
            ? 'order_approved'
            : decision === 'reject'
              ? 'order_rejected'
              : 'payment_approved',
          note
        )
        .run();

      return json({
        ok: true,
        decision,
        warning: 'No supplier order was placed and no supplier payment was made.'
      });
    }

    return json({ error: 'Unknown AliExpress action.' }, 400);

  } catch (e) {
    return fail(e);
  }
}

export const onRequest = handler;