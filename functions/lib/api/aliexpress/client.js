import {
  aeRefreshIfNeeded,
  aeDecrypt
} from '../auth.js';

export async function aeSyncCall(method, business, env) {
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET) {
    throw Object.assign(
      Error('AliExpress app credentials are not configured.'),
      { status: 503 }
    );
  }

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
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0'
  };

  // Generate the AliExpress request signature.
  const signatureText = Object.keys(params)
    .filter(
      key =>
        params[key] !== undefined &&
        params[key] !== null
    )
    .sort()
    .map(
      key =>
        key +
        String(
          typeof params[key] === 'object'
            ? JSON.stringify(params[key])
            : params[key]
        )
    )
    .join('');

  const signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ALIEXPRESS_APP_SECRET),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    new TextEncoder().encode(signatureText)
  );

  params.sign = [...new Uint8Array(signature)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  // Send the request to AliExpress.
  const response = await fetch(
    'https://api-sg.aliexpress.com/sync',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: new URLSearchParams(
        Object.entries(params).map(([key, value]) => [
          key,
          typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
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

  // Extract the method-specific response.
  const root =
    data?.[method.replace(/\./g, '_') + '_response'] ||
    data?.[method + '_response'] ||
    data;

  // Detect AliExpress API errors.
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

    throw Object.assign(
      Error(message),
      {
        status: 502,
        aliexpressDiagnostic: diagnostic
      }
    );
  }

  return root;
}