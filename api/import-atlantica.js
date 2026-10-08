const START = 'https://loja.atlanticanatural.com.br/scott01';
const LIST = 'https://loja.atlanticanatural.com.br/produtos/buscar?ordenacao=Latest&pagina=PAGE&quantidade=100';

const clean = (s = '') => s.replace(/\\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();
const abs = (u, base) => { try { return new URL(u, base).href; } catch { return ''; } };
const decode = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

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
  return m ? clean(decode(m[1].replace(/<[^>]+>/g, ''))) : '';
}

function parseProduct(html, url) {
  const nome =
    first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html) ||
    first(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i, html);

  const categoria =
    first(/Categoria:\s*<[^>]*>\s*([^<]+)/i, html) ||
    first(/Categoria:\s*([^<\n]+)/i, html);

  const imagem =
    first(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i, html) ||
    first(/<img[^>]+src=["']([^"']+)["'][^>]*>/i, html);

  const descricao =
    first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, html) ||
    first(/<div[^>]+class=["'][^"']*(?:descricao|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html);

  if (!nome) return null;
  return { source_url: url, nome, categoria, descricao, imagem: abs(imagem, url), preco: null };
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
      for (const u of links(html, base)) found.add(u);
      if (!html || !/\/produtos\//i.test(html)) break;
    }

    let importados = 0, falhas = 0;
    for (const url of found) {
      try {
        const product = parseProduct(await get(url), url);
        if (product) { await upsert(product); importados++; }
      } catch { falhas++; }
    }

    return res.status(200).json({
      ok: true, encontrados: found.size, importados, falhas,
      preco: 'não importado'
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
