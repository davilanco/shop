const COOKIE = 'davilanco_session';

// ==========================================
// GENERAL RESPONSE AND AUTHENTICATION HELPERS
// ==========================================

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });

export async function sha256(v) {
  const b = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(v)
  );

  return [...new Uint8Array(b)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(n = 32) {
  const b = crypto.getRandomValues(new Uint8Array(n));

  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export async function hashPassword(password, salt) {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));

  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: s,
      iterations: 100000,
      hash: 'SHA-256'
    },
    k,
    256
  );

  return {
    salt: btoa(String.fromCharCode(...s)),
    hash: btoa(String.fromCharCode(...new Uint8Array(bits)))
  };
}

export async function verifyPassword(p, salt, expected) {
  try {
    if (
      typeof salt !== 'string' ||
      typeof expected !== 'string' ||
      !salt ||
      !expected
    ) {
      return false;
    }

    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(salt)
    ) {
      return false;
    }

    const decoded = atob(salt);
    const s = Uint8Array.from(decoded, c => c.charCodeAt(0));

    if (s.length !== 16) return false;

    const result = await hashPassword(p, s);

    return result.hash === expected;
  } catch (error) {
    console.error('Password verification failed:', error);
    return false;
  }
}

export function cookieHeader(t) {
  return COOKIE + '=' + t +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800';
}

export const clearCookie = () =>
  COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export async function getSession(req, env) {
  const t = req.headers
    .get('Cookie')
    ?.split(';')
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);

  if (!t) return null;

  return env.DB.prepare(
    "SELECT u.id,u.name,u.email,u.role,u.referral_code " +
    "FROM sessions s JOIN users u ON u.id=s.user_id " +
    "WHERE s.token_hash=? AND s.expires_at>datetime('now')"
  )
    .bind(await sha256(t))
    .first();
}

export async function requireUser(req, env, roles = []) {
  const u = await getSession(req, env);

  if (!u) {
    throw Object.assign(Error('Please sign in.'), {
      status: 401
    });
  }

  if (roles.length && !roles.includes(u.role)) {
    throw Object.assign(Error('Insufficient permissions.'), {
      status: 403
    });
  }

  return u;
}

export async function body(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) {
    throw Object.assign(Error('JSON request required.'), {
      status: 415
    });
  }

  return req.json();
}


// ==========================================
// ALIEXPRESS ENCODING HELPERS
// ==========================================

export const aeBytesToB64 = b =>
  btoa(String.fromCharCode(...new Uint8Array(b)));

export const aeB64ToBytes = s =>
  Uint8Array.from(atob(s), c => c.charCodeAt(0));


// ==========================================
// ALIEXPRESS SIGNATURE GENERATION
// ==========================================

// Used for AliExpress token endpoints.
export async function aeSignature(path, params, secret) {
  const text =
    path +
    Object.keys(params)
      .filter(
        k =>
          k !== 'sign' &&
          params[k] !== undefined &&
          params[k] !== null
      )
      .sort()
      .map(k => k + String(params[k]))
      .join('');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(text)
  );

  return [...new Uint8Array(sig)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

// Used for the AliExpress synchronous API.
export async function aeSyncSignature(params, secret) {
  const text = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .sort()
    .map(k =>
      k +
      String(
        typeof params[k] === 'object'
          ? JSON.stringify(params[k])
          : params[k]
      )
    )
    .join('');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(text)
  );

  return [...new Uint8Array(sig)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}


// ==========================================
// ALIEXPRESS TOKEN REQUESTS
// ==========================================

export async function aeTokenRequest(path, params, env) {
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET) {
    throw Object.assign(
      Error('AliExpress app credentials are not configured.'),
      { status: 503 }
    );
  }

  const all = {
    ...params,
    app_key: env.ALIEXPRESS_APP_KEY,
    timestamp: String(Date.now()),
    sign_method: 'sha256'
  };

  all.sign = await aeSignature(
    path,
    all,
    env.ALIEXPRESS_APP_SECRET
  );

  const response = await fetch(
    'https://api-sg.aliexpress.com/rest' + path,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: new URLSearchParams(all)
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(
      Error('AliExpress returned an unreadable token response.'),
      { status: 502 }
    );
  }

  if (!response.ok) {
    throw Object.assign(
      Error('AliExpress token request failed (' + response.status + ').'),
      { status: 502 }
    );
  }

  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      break;
    }
  }

  const unwrap = x => {
    for (let i = 0; i < 4 && x && typeof x === 'object'; i++) {
      if (x.access_token || x.refresh_token) return x;

      const k = Object.keys(x).find(
        k => /response|result|body|data/i.test(k)
      );

      if (!k) break;

      let v = x[k];

      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          break;
        }
      }

      x = v;
    }

    return x;
  };

  data = unwrap(data);

  if (
    !data ||
    typeof data !== 'object' ||
    data.error ||
    data.error_description ||
    (
      data.code &&
      String(data.code) !== '0' &&
      !data.access_token
    )
  ) {
    throw Object.assign(
      Error('AliExpress authorization failed. Check app status and API permissions.'),
      { status: 502 }
    );
  }

  if (!data.access_token || !data.refresh_token) {
    throw Object.assign(
      Error('AliExpress did not return both authorization tokens.'),
      { status: 502 }
    );
  }

  return data;
}


// ==========================================
// ALIEXPRESS TOKEN ENCRYPTION
// ==========================================

export async function aeEncryptionKey(env) {
  if (!env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY) {
    throw Object.assign(
      Error('Token encryption key is not configured.'),
      { status: 503 }
    );
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY
    )
  );

  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function aeEncrypt(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aeEncryptionKey(env);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    new TextEncoder().encode(value)
  );

  return aeBytesToB64(iv) + '.' + aeBytesToB64(encrypted);
}

export async function aeDecrypt(value, env) {
  const [ivPart, dataPart] = String(value || '').split('.');

  if (!ivPart || !dataPart) {
    throw Error('Stored AliExpress token cannot be decrypted.');
  }

  const key = await aeEncryptionKey(env);

  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: aeB64ToBytes(ivPart)
    },
    key,
    aeB64ToBytes(dataPart)
  );

  return new TextDecoder().decode(plain);
}


// ==========================================
// ALIEXPRESS TOKEN EXPIRY
// ==========================================

export function aeExpiry(data, absoluteKey, secondsKey) {
  const absolute = Number(data[absoluteKey]);

  if (Number.isFinite(absolute) && absolute > 0) {
    return new Date(
      absolute < 1e12
        ? absolute * 1000
        : absolute
    ).toISOString();
  }

  const seconds = Number(data[secondsKey]);

  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(
      Date.now() + seconds * 1000
    ).toISOString();
  }

  return null;
}


// ==========================================
// ALIEXPRESS TOKEN STORAGE
// ==========================================

export async function aeSaveTokens(data, env) {
  const access = await aeEncrypt(data.access_token, env);
  const refresh = await aeEncrypt(data.refresh_token, env);

  const accessExpiry = aeExpiry(
    data,
    'expire_time',
    'expires_in'
  );

  const refreshExpiry = aeExpiry(
    data,
    'refresh_token_valid_time',
    'refresh_expires_in'
  );

  await env.DB.prepare(
    "INSERT INTO aliexpress_credentials(" +
    "id,access_token_encrypted,refresh_token_encrypted," +
    "access_expires_at,refresh_expires_at,updated_at" +
    ") VALUES('primary',?,?,?,?,CURRENT_TIMESTAMP) " +
    "ON CONFLICT(id) DO UPDATE SET " +
    "access_token_encrypted=excluded.access_token_encrypted," +
    "refresh_token_encrypted=excluded.refresh_token_encrypted," +
    "access_expires_at=excluded.access_expires_at," +
    "refresh_expires_at=excluded.refresh_expires_at," +
    "updated_at=CURRENT_TIMESTAMP"
  )
    .bind(
      access,
      refresh,
      accessExpiry,
      refreshExpiry
    )
    .run();
}


// ==========================================
// ALIEXPRESS AUTOMATIC TOKEN REFRESH
// ==========================================

export async function aeRefreshIfNeeded(env) {
  const current = await env.DB.prepare(
    "SELECT access_token_encrypted,refresh_token_encrypted," +
    "access_expires_at,refresh_expires_at " +
    "FROM aliexpress_credentials WHERE id='primary'"
  ).first();

  if (!current) return null;

  const accessExpiry = Date.parse(
    current.access_expires_at || ''
  );

  if (
    Number.isFinite(accessExpiry) &&
    accessExpiry > Date.now() + 30 * 60 * 1000
  ) {
    return current;
  }

  const refreshExpiry = Date.parse(
    current.refresh_expires_at || ''
  );

  if (
    !Number.isFinite(refreshExpiry) ||
    refreshExpiry <= Date.now()
  ) {
    throw Object.assign(
      Error('AliExpress refresh authorization has expired. Reconnect the account.'),
      { status: 409 }
    );
  }

  const refreshToken = await aeDecrypt(
    current.refresh_token_encrypted,
    env
  );

  const rotated = await aeTokenRequest(
    '/auth/token/refresh',
    { refresh_token: refreshToken },
    env
  );

  const access = await aeEncrypt(
    rotated.access_token,
    env
  );

  const refresh = await aeEncrypt(
    rotated.refresh_token,
    env
  );

  const result = await env.DB.prepare(
    "UPDATE aliexpress_credentials SET " +
    "access_token_encrypted=?," +
    "refresh_token_encrypted=?," +
    "access_expires_at=?," +
    "refresh_expires_at=?," +
    "updated_at=CURRENT_TIMESTAMP " +
    "WHERE id='primary' AND refresh_token_encrypted=?"
  )
    .bind(
      access,
      refresh,
      aeExpiry(rotated, 'expire_time', 'expires_in'),
      aeExpiry(rotated, 'refresh_token_valid_time', 'refresh_expires_in'),
      current.refresh_token_encrypted
    )
    .run();

  if (!result.meta?.changes) {
    const latest = await env.DB.prepare(
      "SELECT access_expires_at FROM aliexpress_credentials " +
      "WHERE id='primary'"
    ).first();

    if (
      !latest ||
      Date.parse(latest.access_expires_at || '') <= Date.now()
    ) {
      throw Object.assign(
        Error('AliExpress token refresh collided with another request. Please retry.'),
        { status: 409 }
      );
    }
  }

  return await env.DB.prepare(
    "SELECT access_token_encrypted,refresh_token_encrypted," +
    "access_expires_at,refresh_expires_at " +
    "FROM aliexpress_credentials WHERE id='primary'"
  ).first();
}