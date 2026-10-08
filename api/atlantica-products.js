const autorizado = (req) =>
  !!process.env.ATLANTICA_ADMIN_PASSWORD &&
  req.headers['x-admin-password'] === process.env.ATLANTICA_ADMIN_PASSWORD;

async function db(path = '', options = {}) {
  const base = process.env.ATLANTICA_DB_URL;
  const key = process.env.ATLANTICA_DB_SERVICE_KEY;
  if (!base || !key) throw new Error('Configure ATLANTICA_DB_URL e ATLANTICA_DB_SERVICE_KEY');

  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/atlantica_products' + path, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.method === 'POST'
        ? 'resolution=merge-duplicates,return=representation'
        : 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const rows = await db('?select=*&order=nome.asc');
      return res.status(200).json(rows);
    }

    if (!autorizado(req)) return res.status(401).json({ erro: 'Senha incorreta' });

    if (req.method === 'POST') {
      const body = req.body || {};
      const row = {
        source_url: String(body.source_url || ''),
        nome: String(body.nome || '').slice(0, 160),
        categoria: String(body.categoria || '').slice(0, 100),
        descricao: String(body.descricao || '').slice(0, 5000),
        imagem: String(body.imagem || '').slice(0, 2000),
        preco: body.preco === '' || body.preco == null ? null : Number(body.preco),
        atualizado_em: new Date().toISOString(),
      };
      if (!row.source_url || !row.nome)
        return res.status(400).json({ erro: 'source_url e nome são obrigatórios' });

      const rows = await db('?on_conflict=source_url', {
        method: 'POST',
        body: JSON.stringify(row),
      });
      return res.status(200).json(rows?.[0] || row);
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ erro: 'id obrigatório' });
      await db(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ erro: 'Erro no servidor: ' + e.message });
  }
}
