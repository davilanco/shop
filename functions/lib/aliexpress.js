import {
  aeRefreshIfNeeded,
  aeDecrypt,
  aeSyncSignature
} from './auth.js';


// ==========================================
// ALIEXPRESS SYNCHRONOUS API REQUEST
// ==========================================

export async function aeSyncCall(method, business, env) {
  const current = await aeRefreshIfNeeded(env);

  if (!current) {
    throw Object.assign(
      Error('Connect AliExpress before using supplier tools.'),
      { status: 409 }
    );
  }

  const token = await aeDecrypt(
    current.access_token_encrypted,
    env
  );

  const params = {
    ...business,
    app_key: env.ALIEXPRESS_APP_KEY,
    method,
    session: token,
    timestamp: new Date().toISOString().replace(/\.\\d{3}Z$/, 'Z'),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0'
  };

  params.sign = await aeSyncSignature(
    params,
    env.ALIEXPRESS_APP_SECRET
  );

  const response = await fetch(
    'https://api-sg.aliexpress.com/sync',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: new URLSearchParams(
        Object.entries(params).map(([k, v]) => [
          k,
          typeof v === 'object'
            ? JSON.stringify(v)
            : String(v)
        ])
      )
    }
  );

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
      Error(
        'AliExpress API request failed (' +
        response.status +
        ').'
      ),
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
      code: String(
        aeError.code ??
        aeError.error_code ??
        root?.code ??
        ''
      ),

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


// ==========================================
// ALIEXPRESS RESPONSE HELPERS
// ==========================================

export const aeData = x =>
  x?.data || x?.result || x;


export const aeProducts = x => {
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

  if (
    Array.isArray(a) &&
    a.length === 1 &&
    Array.isArray(a[0])
  ) {
    a = a[0];
  }

  return Array.isArray(a) ? a : [];
};


export const aeProductId = x =>
  String(
    x?.itemId ??
    x?.productId ??
    x?.product_id ??
    x?.item_id ??
    ''
  );


export const aeProductTitle = x =>
  String(
    x?.title ??
    x?.product_title ??
    x?.subject ??
    'AliExpress product'
  ).slice(0, 160);


export const aeProductImage = x =>
  String(
    x?.itemMainPic ??
    x?.imageUrl ??
    x?.image_url ??
    x?.product_main_image_url ??
    x?.image ??
    ''
  ).slice(0, 1000);