PRAGMA foreign_keys = ON;

-- ==========================================
-- 1. USERS
-- ==========================================

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
        CHECK(role IN ('customer','seller','admin')),
    referral_code TEXT NOT NULL UNIQUE,
    referred_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    photo TEXT,
    email_verified_at INTEGER,
    verification_token_hash TEXT,
    verification_expires_at INTEGER,
    verification_sent_at INTEGER
);

CREATE INDEX idx_users_verification_token
ON users(verification_token_hash);


-- ==========================================
-- 2. SESSIONS
-- ==========================================

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX sessions_token_idx
ON sessions(token_hash);


-- ==========================================
-- 3. PRODUCTS
-- ==========================================

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK(price > 0),
    image TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'others',
    stock INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','active','rejected','archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX products_status_idx
ON products(status, created_at);


-- ==========================================
-- 4. ORDERS
-- ==========================================

CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    order_number TEXT NOT NULL UNIQUE,
    total INTEGER NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    payment_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_city TEXT NOT NULL,
    delivery_state TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 5. ORDER ITEMS
-- ==========================================

CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL
);


-- ==========================================
-- 6. SELLER APPLICATIONS
-- ==========================================

CREATE TABLE seller_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    business_name TEXT NOT NULL,
    details TEXT NOT NULL,
    document_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
);


-- ==========================================
-- 7. MESSAGES
-- ==========================================

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 8. SUBSCRIBERS
-- ==========================================

CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 9. MUSIC COMMENTS
-- ==========================================

CREATE TABLE music_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- 10. PROCESSED WEBHOOKS
-- ==========================================

CREATE TABLE processed_webhooks (
    idempotency_key TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 11. ALIEXPRESS PRODUCTS
-- ==========================================

CREATE TABLE aliexpress_products (
    product_id TEXT PRIMARY KEY
        REFERENCES products(id) ON DELETE CASCADE,
    ae_product_id TEXT NOT NULL UNIQUE,
    product_url TEXT NOT NULL DEFAULT '',
    supplier_name TEXT NOT NULL DEFAULT 'AliExpress',
    supplier_status TEXT NOT NULL DEFAULT 'active',
    source_currency TEXT NOT NULL DEFAULT '',
    source_price REAL,
    source_payload TEXT NOT NULL DEFAULT '{}',
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX aliexpress_products_ae_id_idx
ON aliexpress_products(ae_product_id);


-- ==========================================
-- 12. ALIEXPRESS PRODUCT SKUS
-- ==========================================

CREATE TABLE aliexpress_product_skus (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL
        REFERENCES aliexpress_products(product_id) ON DELETE CASCADE,
    ae_sku_id TEXT NOT NULL,
    sku_attributes TEXT NOT NULL DEFAULT '[]',
    supplier_price REAL,
    supplier_currency TEXT NOT NULL DEFAULT '',
    available_stock INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    raw_payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, ae_sku_id)
);

CREATE INDEX aliexpress_skus_product_idx
ON aliexpress_product_skus(product_id);


-- ==========================================
-- 13. ALIEXPRESS FREIGHT QUOTES
-- ==========================================

CREATE TABLE aliexpress_freight_quotes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL
        REFERENCES aliexpress_products(product_id) ON DELETE CASCADE,
    ae_sku_id TEXT NOT NULL,
    ship_to_country TEXT NOT NULL DEFAULT 'NG',
    logistics_service_name TEXT NOT NULL,
    shipping_fee REAL NOT NULL,
    shipping_currency TEXT NOT NULL,
    min_delivery_days INTEGER,
    max_delivery_days INTEGER,
    quoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    raw_payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX aliexpress_freight_product_idx
ON aliexpress_freight_quotes(
    product_id,
    ae_sku_id,
    quoted_at DESC
);


-- ==========================================
-- 14. ALIEXPRESS SUPPLIER ORDERS
-- ==========================================

CREATE TABLE aliexpress_supplier_orders (
    id TEXT PRIMARY KEY,
    local_order_id TEXT NOT NULL UNIQUE
        REFERENCES orders(id) ON DELETE RESTRICT,
    out_order_id TEXT NOT NULL UNIQUE,
    ae_order_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'awaiting_admin_approval',
    payment_status TEXT NOT NULL DEFAULT 'not_requested',
    order_request_json TEXT NOT NULL DEFAULT '{}',
    supplier_response_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT NOT NULL DEFAULT '',
    submitted_at TEXT,
    payment_approved_by TEXT REFERENCES users(id),
    payment_approved_at TEXT,
    paid_at TEXT,
    tracking_number TEXT NOT NULL DEFAULT '',
    tracking_carrier TEXT NOT NULL DEFAULT '',
    tracking_payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX aliexpress_supplier_orders_status_idx
ON aliexpress_supplier_orders(status, created_at DESC);


-- ==========================================
-- 15. ALIEXPRESS SUPPLIER ORDER ITEMS
-- ==========================================

CREATE TABLE aliexpress_supplier_order_items (
    id TEXT PRIMARY KEY,
    supplier_order_id TEXT NOT NULL
        REFERENCES aliexpress_supplier_orders(id) ON DELETE CASCADE,
    local_order_item_id TEXT NOT NULL UNIQUE
        REFERENCES order_items(id) ON DELETE RESTRICT,
    ae_product_id TEXT NOT NULL,
    ae_sku_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    logistics_service_name TEXT NOT NULL DEFAULT '',
    supplier_unit_price REAL,
    supplier_currency TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX aliexpress_supplier_order_items_order_idx
ON aliexpress_supplier_order_items(supplier_order_id);


-- ==========================================
-- 16. ALIEXPRESS APPROVAL EVENTS
-- ==========================================

CREATE TABLE aliexpress_approval_events (
    id TEXT PRIMARY KEY,
    supplier_order_id TEXT NOT NULL
        REFERENCES aliexpress_supplier_orders(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX aliexpress_approval_events_order_idx
ON aliexpress_approval_events(
    supplier_order_id,
    created_at DESC
);


-- ==========================================
-- 17. ALIEXPRESS CREDENTIALS
-- ==========================================

CREATE TABLE aliexpress_credentials (
    id TEXT PRIMARY KEY,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    access_expires_at TEXT,
    refresh_expires_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 18. ALIEXPRESS OAUTH STATES
-- ==========================================

CREATE TABLE aliexpress_oauth_states (
    state_hash TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);