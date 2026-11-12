# Deploy Davilanco Shop

1. Connect this GitHub repository to Cloudflare Pages. Framework preset: None; build command blank; output directory: / (repository root). The `functions/` folder must remain at repository root.
2. Create a Cloudflare D1 database named `davilanco-shop-db`. Replace `database_id` in `wrangler.toml` and bind it to Pages Functions using binding name `DB`.
3. Apply schema: `npx wrangler d1 migrations apply davilanco-shop-db --remote`.
4. Set Cloudflare Pages secret `PAYSTACK_SECRET_KEY`. Set `AE_WEBHOOK_SECRET` for the guarded webhook. Never commit credentials.
5. Register your own customer account, then promote it in D1: `UPDATE users SET role='admin' WHERE email='YOUR_EMAIL';`. Sign out and back in.
6. Configure Paystack test/live credentials and verify payment callbacks. Amount is calculated server-side from D1 product prices, not browser-submitted totals.

## Current integration boundaries
AliExpress partner credentials/API adapters are not supplied by this project. The supplier-order endpoint intentionally remains disabled until a verified partner API and admin approval process exist. Seller document URL is a placeholder; use private object storage and signed uploads before collecting identity documents. Add rate limiting, transactional email, monitoring, webhook signature verification with provider-specific signatures, idempotency and security review before production launch.

## Included
Static storefront, search/category filters, local cart, login/registration, PBKDF2 password hashing, server-side sessions, role-protected pages and APIs, customer dashboard, D1 schema, seller applications, admin analytics, Paystack initialize/verify endpoints.
