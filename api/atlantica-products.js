const autorizado = (req) => !!process.env.ATLANTICA_ADMIN_PASSWORD && req.headers['x-admin-password'] === process.env.ATLANTICA_ADMIN_PASSWORD;

async function db(path = '', options = {}) {
  const base = process.env.ATLANTICA_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Configure a URL e a chave do Supabase');
  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/atlantica_products' + path, {
    ...options,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      Prefer: options.method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
      ...(options.headers || {}) }
  });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
}
function numberPrice(value) {
  if (value === '' || value == null) return null;
  const normalized = String(value).trim().replace(/R\$\s?/gi, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) throw new Error('Preço inválido');
  return Number(n.toFixed(2));
}
function upper(value){return String(value??'').trim().toUpperCase();}
function sentence(value){const s=String(value??'').trim().toLowerCase();return s?s.charAt(0).toUpperCase()+s.slice(1):'';}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') { if (String(req.query.admin || '') === '1' && !autorizado(req)) return res.status(401).json({ erro: 'Senha incorreta' }); return res.status(200).json(await db('?select=*&categoria=not.eq.' + encodeURIComponent('__LOJA_CONFIG__') + '&order=nome.asc')); }
    if (!autorizado(req)) return res.status(401).json({ erro: 'Senha incorreta' });

    if (req.method === 'POST') {
      const body = req.body || {};
      const row = { source_url: String(body.source_url || ''), nome: upper(body.nome).slice(0,160),
        categoria: upper(body.categoria).slice(0,100), descricao: sentence(body.descricao).slice(0,5000),
        imagem: String(body.imagem || '').trim().slice(0,2000), preco: numberPrice(body.preco), atualizado_em: new Date().toISOString() };
      if (!row.source_url || !row.nome) return res.status(400).json({ erro: 'source_url e nome são obrigatórios' });
      if (row.categoria === '__LOJA_CONFIG__') return res.status(400).json({ erro: 'Categoria reservada.' });
      const rows = await db('?on_conflict=source_url', { method: 'POST', body: JSON.stringify(row) });
      return res.status(200).json(rows?.[0] || row);
    }

    if (req.method === 'PATCH') {
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ erro: 'id obrigatório' });
      const body = req.body || {};
      const row = { nome: upper(body.nome).slice(0,160), categoria: upper(body.categoria).slice(0,100),
        descricao: sentence(body.descricao).slice(0,5000), imagem: String(body.imagem || '').trim().slice(0,2000),
        preco: numberPrice(body.preco), atualizado_em: new Date().toISOString() };
      if (!row.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
      if (row.categoria === '__LOJA_CONFIG__') return res.status(400).json({ erro: 'Categoria reservada.' });
      const rows = await db('?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(row) });
      if (!rows?.length) return res.status(404).json({ erro: 'Produto não encontrado' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (id) { await db('?id=eq.' + encodeURIComponent(id) + '&categoria=not.eq.' + encodeURIComponent('__LOJA_CONFIG__'), { method: 'DELETE' }); return res.status(200).json({ ok:true, excluidos:1 }); }
      await db('?categoria=not.eq.' + encodeURIComponent('__LOJA_CONFIG__'), { method:'DELETE' });
      return res.status(200).json({ ok:true, todos:true });
    }
    return res.status(405).end();
  } catch (e) { return res.status(500).json({ erro: 'Erro no servidor: ' + e.message }); }
}