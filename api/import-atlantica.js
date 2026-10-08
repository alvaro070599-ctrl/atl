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
  .replace(/&gt;/gi, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function stripHtml(s = '') {
  return clean(decode(String(s).replace(/<[^>]+>/g, ' ')));
}

function isProductUrl(u) {
  try {
    const path = new URL(u).pathname.replace(/\/+$/, '');
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
  let category = stripHtml(value)
    .replace(/^categoria\s*:\s*/i, '')
    .replace(/^categoria\s*[-–—:]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!category || category.length > 80) return '';

  // Nunca aceite texto que pareça código, SKU ou texto técnico vazado.
  if (/[#;:{}\[\]<>]/.test(category)) return '';
  if (/\b(jogo da velha|ponto e vírgula|determina|undefined|null|object object)\b/i.test(category)) return '';
  if (/\d{2,}/.test(category)) return '';
  if (/^[A-Z0-9._:/-]+(?:\s+[A-Z0-9._:/-]+)*$/i.test(category)) return '';

  // Categoria real é curta e textual; evita frases inteiras de navegação.
  const words = category.split(/\s+/).filter(Boolean);
  if (words.length > 5) return '';

  return category;
}

function extractCategory(html) {
  // 1) A fonte mais confiável: link da própria categoria.
  const categoryLink =
    first(/(?:categoria|category)[^<]{0,300}<a[^>]+href=["'][^"']*\/produtos\/(?:categoria|departamento)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i, html) ||
    first(/<a[^>]+href=["'][^"']*\/produtos\/(?:categoria|departamento)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i, html);

  const fromLink = cleanCategory(categoryLink);
  if (fromLink) return fromLink;

  // 2) JSON-LD, quando a loja informar a categoria corretamente.
  const ldCategory = cleanCategory(arguments[1] || '');
  if (ldCategory) return ldCategory;

  // 3) Texto "Categoria:" somente quando o trecho seguinte for claramente curto.
  const labeled = first(/Categoria\s*:\\s*(?:<[^>]*>\\s*)?([^<\\n]{1,80})/i, html);
  return cleanCategory(labeled);
}

function isLikelyProductImage(value = '') {
(value = '') {
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
  let name = stripHtml(value)
    .replace(/\s+/g, ' ')
    .trim();

  // Remove prefixos que claramente são códigos/SKUs.
  name = name
    .replace(/^(?:[A-Z]{1,6}[-_ ]?\d{2,}[A-Z0-9#*_.;:/-]*[\s:.;,-]*)+/i, '')
    .replace(/^(?:\d{2,}[A-Z0-9#*_.;:/-]*[\s:.;,-]*)+/i, '')
    .replace(/^(?:SKU|COD(?:IGO)?|REF(?:ERENCIA)?)\s*[:#-]?\s*[A-Z0-9._#*;-]+\s*/i, '')
    .replace(/^(?:categoria)\s*[:#-]\s*/i, '');

  // Remove códigos que ficaram no meio/final do nome.
  name = name
    .replace(/(?:^|\s)[A-Z]{1,6}[-_ ]?\d{2,}[A-Z0-9#*_.;:/-]*(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)[A-Z0-9]{1,6}#[A-Z0-9._;-]{2,}(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)\d{2,}[#;][A-Z0-9._-]*(?=\s|$)/gi, ' ');

  name = name
    .replace(/^[|•·:;,_-]+|[|•·:;,_-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Evita gravar texto que claramente não é nome de produto.
  if (!name || name.length > 180) return '';
  if (/^(categoria|produto|descrição|description)\s*[:#-]/i.test(name)) return '';

  return name;
}

function betterName(h1, ldName, ogTitle, url) {
  const candidates = [h1, ldName, ogTitle]
    .map(cleanProductName)
    .filter(Boolean);

  // H1 é o título visual da página e, nesta loja, é a fonte preferida.
  if (candidates[0]) return candidates[0];
  if (candidates[1]) return candidates[1];
  if (candidates[2]) return candidates[2];

  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return cleanProductName(slug.replace(/[-_]+/g, ' '));
  } catch {
    return '';
  }
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

  const h1 = first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  const ogTitle = first(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i, html);
  const nome = betterName(h1, ld.name, ogTitle, url);

  const ldCategory = typeof ld.category === 'string' ? ld.category : '';
  const categoria = extractCategory(html, ldCategory);

  const imageCandidates = [
    Array.isArray(ld.image) ? ld.image[0] : ld.image,
    first(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i, html),
    first(/<img[^>]+(?:class|id)=["'][^"']*product[^"']*["'][^>]+src=["']([^"']+)["']/i, html),
    first(/<img[^>]+src=["']([^"']+product_img[^"']*)["'][^>]*>/i, html),
  ].filter(isLikelyProductImage);

  const imagem = imageCandidates[0] || '';

  const descricao =
    typeof ld.description === 'string' ? ld.description :
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
    categoria: categoria || '',
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

async function upsertMany(rows) {
  const base = process.env.ATLANTICA_DB_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY;
  if (!base || !key) throw new Error('Configure ATLANTICA_DB_URL e ATLANTICA_DB_SERVICE_KEY');
  if (!rows.length) return;

  const payload = rows.map((row) => ({ ...row, atualizado_em: new Date().toISOString() }));
  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/atlantica_products?on_conflict=source_url', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
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
    const pages = 1;
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

    // Busca os produtos em paralelo e grava tudo em uma única chamada ao Supabase.
    const results = await Promise.all(urls.map(async (url) => {
      try {
        const product = parseProduct(await get(url), url);
        return product ? { product, ok: true } : { product: null, ok: true };
      } catch {
        return { product: null, ok: false };
      }
    }));

    const products = results.filter((x) => x.product).map((x) => x.product);
    falhas = results.filter((x) => !x.ok).length;

    if (products.length) {
      try {
        await upsertMany(products);
        importados = products.length;
      } catch {
        falhas += products.length;
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
