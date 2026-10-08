const START = 'https://loja.atlanticanatural.com.br/scott01';
const LIST = 'https://loja.atlanticanatural.com.br/produtos/buscar?ordenacao=Latest&pagina=PAGE&quantidade=100';

const clean = (s = '') => String(s)
  .replace(/\s+/g, ' ')
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

function isProductUrl(u) {
  try {
    const path = new URL(u).pathname.replace(/\\/+$/, '');
    if (!/^\/produtos\//i.test(path)) return false;

    // These are navigation/category/search pages, not individual products.
    const blocked = [
      /^\/produtos\/$/i,
      /^\/produtos\/buscar(?:\/|$)/i,
      /^\/produtos\/categoria(?:\/|$)/i,
      /^\/produtos\/departamento(?:\/|$)/i,
      /^\/produtos\/produto(?:\/|$)/i,
    ];
    if (blocked.some((re) => re.test(path))) return false;

    // Individual product pages are /produtos/slug or /produtos/marca/slug.
    return /^\/produtos\/[^/?#]+(?:\/[^/?#]+)?$/i.test(path);
  } catch {
    return false;
  }
}

function links(html, base) {
  const out = [], re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = abs(decode(m[1]), base);
    if (u && isProductUrl(u)) out.push(u.split('#')[0]);
  }
  return [...new Set(out)];
}

function cleanCategory(value = '') {
  const category = stripHtml(value)
    .replace(/^categoria\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Reject leaked IDs/SKUs or markup-like garbage.
  if (!category || category.length > 80) return '';
  if (/^[A-Z0-9#*._:/-]{2,}(?:\s+[A-Z0-9#*._:/-]{1,})?$/i.test(category) &&
      /\d/.test(category) &&
      !/[A-Za-zÀ-ÿ]{3,}\s+[A-Za-zÀ-ÿ]{3,}/.test(category)) return '';

  return category;
}

function isLikelyProductImage(value = '') {
  const s = String(value).toLowerCase();
  if (!s) return false;
  if (/(logo|logotipo|favicon|icon|header|footer|menu|banner|sprite|placeholder)/i.test(s)) return false;
  return true;
}

function first(re, html) {
  const m = html.match(re);
  return m ? stripHtml(m[1]) : '';
}

function jsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
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
    .replace(/^(?:[A-Z]{1,4}[-_ ]?\d{2,}[A-Z0-9#*_-]*[\s:.-]*)+/i, '')
    .replace(/(?:^|\s)[A-Z]{1,4}[-_ ]?\d{2,}[A-Z0-9#*_-]*(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)[A-Z0-9]{1,5}#[A-Z0-9_-]{2,}(?=\s|$)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[|•·:;,_-]+|[|•·:;,_-]+$/g, '')
    .trim();

  return name;
}

function numberFrom(value) {
  if (value == null || value === '') return null;
  let s = String(value).trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseProduct(html, url) {
  const ld = jsonLdProducts(html)[0] || {};
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : (ld.offers || {});

  const nome = cleanProductName(
    ld.name ||
    first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html) ||
    first(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i, html)
  );

  const categoria = cleanCategory(
    ld.category ||
    first(/Categoria\s*:\s*<[^>]*>\s*([^<]+)/i, html) ||
    first(/Categoria\s*:\s*([^<\n]+)/i, html)
  );

  const imageCandidates = [
    Array.isArray(ld.image) ? ld.image[0] : ld.image,
    first(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i, html),
    first(/<img[^>]+(?:class|id)=["'][^"']*product[^"']*["'][^>]+src=["']([^"']+)["']/i, html),
    first(/<img[^>]+src=["']([^"']+product_img[^"']*)["'][^>]*>/i, html),
  ].filter(isLikelyProductImage);

  const imagem = imageCandidates[0] || '';

  const descricao =
    ld.description ||
    first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, html) ||
    first(/<div[^>]+class=["'][^"']*(?:descricao|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html);

  const preco =
    numberFrom(offers.price) ??
    numberFrom(offers.lowPrice) ??
    numberFrom(first(/(?:preço|preco|por)\s*[:\-]?\s*R?\$?\s*([\d.,]+)/i, html));

  if (!nome) return null;

  return {
    source_url: url,
    nome,
    categoria: clean(categoria),
    descricao: stripHtml(descricao),
    imagem: imagem ? abs(imagem, url) : '',
    preco,
  };
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CatalogImporter/1.0' } });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.text();
}

async function upsert(row) {
  const base = process.env.ATLANTICA_DB_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY;
  if (!base || !key) throw new Error('Configure ATLANTICA_DB_URL e ATLANTICA_DB_SERVICE_KEY');

  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/atlantica_products?on_conflict=source_url', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ ...row, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function existingUrls() {
  const base = process.env.ATLANTICA_DB_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY;
  if (!base || !key) throw new Error('Configure ATLANTICA_DB_URL e ATLANTICA_DB_SERVICE_KEY');

  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/atlantica_products?select=source_url&source_url=not.is.null', {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(await r.text());

  const rows = await r.json();
  return new Set(rows.map((x) => x.source_url).filter(Boolean));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.ATLANTICA_ADMIN_PASSWORD || req.headers['x-admin-password'] !== process.env.ATLANTICA_ADMIN_PASSWORD)
    return res.status(401).json({ erro: 'Senha incorreta' });

  try {
    // A função trabalha em pequenos lotes. Cada chamada importa no máximo 20
    // produtos novos e deixa os próximos para a próxima chamada.
    const pages = Math.min(10, Math.max(1, Number(req.body?.paginas || 3)));
    const lote = Math.min(20, Math.max(1, Number(req.body?.lote || 20)));

    const found = new Set();

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

    const already = await existingUrls();
    const pending = [...found].filter((url) => !already.has(url));
    const urls = pending.slice(0, lote);

    let importados = 0;
    let falhas = 0;

    // Sequencial de propósito: evita sobrecarregar a Atlântica, o Supabase
    // e a própria Function da Vercel.
    for (const url of urls) {
      try {
        const product = parseProduct(await get(url), url);
        if (product) {
          await upsert(product);
          importados++;
        }
      } catch {
        falhas++;
      }
    }

    return res.status(200).json({
      ok: true,
      encontrados: found.size,
      ja_existiam: found.size - pending.length,
      processados: urls.length,
      importados,
      falhas,
      restantes: Math.max(0, pending.length - urls.length),
      mensagem: pending.length > urls.length
        ? 'Lote concluído. Execute a importação novamente para continuar.'
        : 'Importação concluída.',
      preco: 'importado quando disponível no catálogo',
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro no importador: ' + e.message });
  }
}
