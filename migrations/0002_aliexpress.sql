PRAGMA foreign_keys=ON;

-- AliExpress product mapping. Imported products remain in products.status='pending'
-- until an administrator explicitly approves them in the normal product workflow.
CREATE TABLE IF NOT EXISTS aliexpress_products (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  ae_product_id TEXT NOT NULL UNIQUE,
  product_url TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT 'AliExpress',
  supplier_status TEXT NOT NULL DEFAULT 'active'
    CHECK (supplier_status IN ('active','unavailable','deleted','unknown')),
  source_currency TEXT NOT NULL DEFAULT '',
  source_price REAL,
  source_payload TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS aliexpress_products_ae_id_idx
  ON aliexpress_products(ae_product_id);

-- SKU/variant details are kept separately so a customer-facing product can
-- retain the existing products table while the supplier SKU remains traceable.
CREATE TABLE IF NOT EXISTS aliexpress_product_skus (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES aliexpress_products(product_id) ON DELETE CASCADE,
  ae_sku_id TEXT NOT NULL,
  sku_attributes TEXT NOT NULL DEFAULT '[]',
  supplier_price REAL,
  supplier_currency TEXT NOT NULL DEFAULT '',
  available_stock INTEGER NOT NULL DEFAULT 0 CHECK (available_stock >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1)),
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, ae_sku_id)
);

CREATE INDEX IF NOT EXISTS aliexpress_skus_product_idx
  ON aliexpress_product_skus(product_id);

-- Store the latest shipping quote returned for a specific product/SKU and
-- destination. Quotes expire and must be refreshed before supplier checkout.
CREATE TABLE IF NOT EXISTS aliexpress_freight_quotes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES aliexpress_products(product_id) ON DELETE CASCADE,
  ae_sku_id TEXT NOT NULL,
  ship_to_country TEXT NOT NULL DEFAULT 'NG',
  logistics_service_name TEXT NOT NULL,
  shipping_fee REAL NOT NULL CHECK (shipping_fee >= 0),
  shipping_currency TEXT NOT NULL,
  min_delivery_days INTEGER,
  max_delivery_days INTEGER,
  quoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  raw_payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS aliexpress_freight_product_idx
  ON aliexpress_freight_quotes(product_id, ae_sku_id, quoted_at DESC);

-- One supplier order record per local store order. The unique idempotency key
-- prevents retries from creating duplicate AliExpress orders.
CREATE TABLE IF NOT EXISTS aliexpress_supplier_orders (
  id TEXT PRIMARY KEY,
  local_order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  out_order_id TEXT NOT NULL UNIQUE,
  ae_order_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_admin_approval'
    CHECK (status IN (
      'awaiting_admin_approval',
      'approved_to_submit',
      'submitted',
      'awaiting_payment_approval',
      'payment_approved',
      'paid',
      'failed',
      'cancelled'
    )),
  payment_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (payment_status IN (
      'not_requested',
      'awaiting_approval',
      'approved',
      'paid',
      'failed'
    )),
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

CREATE INDEX IF NOT EXISTS aliexpress_supplier_orders_status_idx
  ON aliexpress_supplier_orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS aliexpress_supplier_orders_ae_order_idx
  ON aliexpress_supplier_orders(ae_order_id);

-- Link each locally purchased line to the exact AliExpress product/SKU and
-- logistics option selected for fulfilment.
CREATE TABLE IF NOT EXISTS aliexpress_supplier_order_items (
  id TEXT PRIMARY KEY,
  supplier_order_id TEXT NOT NULL REFERENCES aliexpress_supplier_orders(id) ON DELETE CASCADE,
  local_order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  ae_product_id TEXT NOT NULL,
  ae_sku_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  logistics_service_name TEXT NOT NULL DEFAULT '',
  supplier_unit_price REAL,
  supplier_currency TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS aliexpress_supplier_order_items_order_idx
  ON aliexpress_supplier_order_items(supplier_order_id);

-- Immutable approval/action history. In particular, supplier payment cannot
-- be triggered unless a separate payment_approved event exists.
CREATE TABLE IF NOT EXISTS aliexpress_approval_events (
  id TEXT PRIMARY KEY,
  supplier_order_id TEXT NOT NULL REFERENCES aliexpress_supplier_orders(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'supplier_order_approved',
      'supplier_order_rejected',
      'supplier_payment_approved',
      'supplier_payment_rejected'
    )),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS aliexpress_approval_events_order_idx
  ON aliexpress_approval_events(supplier_order_id, created_at DESC);
