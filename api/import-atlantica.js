const START = 'https://loja.atlanticanatural.com.br/scott01';
const LIST = 'https://loja.atlanticanatural.com.br/produtos/buscar?ordenacao=Latest&pagina=PAGE&quantidade=100';

const clean = (s = '') => String(s)
  .replace(/\\s+/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .trim();

const abs = (u, base) => {
  try { return new URL(u, base).href; } catch { return ''; }
};

const decode = (s = '') => String(s)
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&#x27;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

function stripHtml(s = '') {
  return clean(decode(String(s).replace(/<[^>]+>/g, ' ')));
}

function links(html, base) {
  const out = [], re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = abs(decode(m[1]), base);
    if (u && /\/produtos\//i.test(new URL(u).pathname)) out.push(u.split('#')[0]);
  }
  return [...new Set(out)];
}

function first(re, html) {
  const m = html.match(re);
  return m ? stripHtml(m[1]) : '';
}

function jsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\\s\\S]*?)<\/script>/gi;
  let m;

  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item) continue;
        if (item['@type'] === 'Product') out.push(item);
        if (Array.isArray(item['@graph'])) {
          for (const graphItem of item['@graph']) {
            if (graphItem?.['@type'] === 'Product') out.push(graphItem);
          }
        }
      }
    } catch {}
  }

  return out;
}

function cleanProductName(value = '') {
  let name = stripHtml(value);

  // Remove common internal SKU/code blocks when they leak into the title.
  name = name
    .replace(/^(?:[A-Z]{1,4}[-_ ]?\\d{2,}[A-Z0-9#*_-]*[\\s:.-]*)+/i, '')
    .replace(/(?:^|\\s)[A-Z]{1,4}[-_ ]?\\d{2,}[A-Z0-9#*_-]*(?=\\s|$)/gi, ' ')
    .replace(/(?:^|\\s)[A-Z0-9]{1,5}#[A-Z0-9_-]{2,}(?=\\s|$)/gi, ' ')
    .replace(/\\s{2,}/g, ' ')
    .replace(/^[|•·:;,_-]+|[|•·:;,_-]+$/g, '')
    .trim();

  return name;
}

function numberFrom(value) {
  if (value == null || value === '') return null;
  let s = String(value).trim().replace(/R\\$\\s?/i, '').replace(/\\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseProduct(html, url) {
  const ld = jsonLdProducts(html)[0] || {};
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : (ld.offers || {});

  const nome = cleanProductName(
    ld.name ||
    first(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/i, html) ||
    first(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i, html)
  );

  const categoria =
    stripHtml(ld.category || '') ||
    first(/Categoria\\s*:\\s*<[^>]*>\\s*([^<]+)/i, html) ||
    first(/Categoria\\s*:\\s*([^<\\n]+)/i, html);

  const imagem =
    (Array.isArray(ld.image) ? ld.image[0] : ld.image) ||
    first(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i, html) ||
    first(/<img[^>]+src=["']([^"']+)["'][^>]*>/i, html);

  const descricao =
    ld.description ||
    first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, html) ||
    first(/<div[^>]+class=["'][^"']*(?:descricao|description)[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>/i, html);

  const preco =
    numberFrom(offers.price) ??
    numberFrom(offers.lowPrice) ??
    numberFrom(first(/(?:preço|preco|por)\\s*[:\\-]?\\s*R?\\$?\\s*([\\d.,]+)/i, html));

  if (!nome) return null;

  return {
    source_url: url,
    nome,
    categoria: clean(categoria),
    descricao: stripHtml(descricao),
    imagem: abs(imagem, url),
    preco,
  };
}

async function get(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CatalogImporter/1.0' }, signal: controller.signal });
    if (!r.ok) throw new Error(`${r.status} em ${url}`);
    return r.text();
  } finally {
    clearTimeout(timer);
  }
}

async function upsert(row) {
  const base = process.env.ATLANTICA_DB_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY;
  if (!base || !key) throw new Error('Configure ATLANTICA_DB_URL e ATLANTICA_DB_SERVICE_KEY');

  const r = await fetch(base.replace(/\\/$/, '') + '/rest/v1/atlantica_products?on_conflict=source_url', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ ...row, atualizado_em: new Date().toISOString() }),
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!r.ok) throw new Error(await r.text());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.ATLANTICA_ADMIN_PASSWORD || req.headers['x-admin-password'] !== process.env.ATLANTICA_ADMIN_PASSWORD)
    return res.status(401).json({ erro: 'Senha incorreta' });

  try {
    const found = new Set();
    const pages = Math.min(100, Math.max(1, Number(req.body?.paginas || 30)));

    const home = await get(START);
    for (const u of links(home, START)) found.add(u);

    for (let page = 1; page <= pages; page++) {
      const base = LIST.replace('PAGE', String(page));
      const html = await get(base);
      const pageLinks = links(html, base);
      const before = found.size;
      for (const u of pageLinks) found.add(u);
      if (!pageLinks.length || found.size === before) break;
    }

    let importados = 0, falhas = 0;
    const urls = [...found];
    const concurrency = 8;
    for (let i = 0; i < urls.length; i += concurrency) {
      const lote = urls.slice(i, i + concurrency);
      const resultados = await Promise.all(lote.map(async (url) => {
        try {
          const product = parseProduct(await get(url), url);
          if (product) {
            await upsert(product);
            return { ok: true, imported: true };
          }
          return { ok: true, imported: false };
        } catch {
          return { ok: false, imported: false };
        }
      }));
      for (const r of resultados) {
        if (r.imported) importados++;
        if (!r.ok) falhas++;
      }
    }

    return res.status(200).json({
      ok: true,
      encontrados: found.size,
      importados,
      falhas,
      preco: 'importado quando disponível no catálogo',
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
