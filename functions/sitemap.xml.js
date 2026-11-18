export async function onRequestGet({ env }) {
  const base = 'https://shop.davilanco.com';

  const staticPages = [
    { loc: `${base}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${base}/categories.html`, priority: '0.9', changefreq: 'daily' },
    { loc: `${base}/category.html`, priority: '0.8', changefreq: 'daily' },
    { loc: `${base}/product.html`, priority: '0.8', changefreq: 'daily' },
  ];

  let productUrls = '';
  let categoryUrls = '';

  try {
    // 1. Products - only active ones, from your real schema
    // products: id TEXT, name, price, category, status, created_at
    // No slug, no updated_at - so we use id + created_at
    const { results } = await env.DB.prepare(
      `SELECT id, category, created_at FROM products WHERE status = 'active' ORDER BY created_at DESC LIMIT 5000`
    ).all();

    productUrls = results.map(p => {
      const lastmod = p.created_at ? `<lastmod>${String(p.created_at).split('T')[0]}</lastmod>` : '';
      return `<url><loc>${base}/product.html?id=${p.id}</loc>${lastmod}<changefreq>weekly</changefreq><priority>0.7</priority></url>`;
    }).join('\n');

    // 2. Category pages - auto from your real categories
    const cats = [...new Set(results.map(p => p.category).filter(Boolean))];
    categoryUrls = cats.map(c =>
      `<url><loc>${base}/categories.html?category=${encodeURIComponent(c)}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`
    ).join('\n');

  } catch (e) {
    console.log('Sitemap DB error', e.message);
  }

  const staticXml = staticPages.map(p =>
    `<url><loc>${p.loc}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${categoryUrls}
${productUrls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}