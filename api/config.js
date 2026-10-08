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
const autorizado = (req) => !!process.env.ATLANTICA_ADMIN_PASSWORD && req.headers['x-admin-password'] === process.env.ATLANTICA_ADMIN_PASSWORD;
function envConfig() {
  const lojaId = String(process.env.LOJA_ID || '').trim();
  return { lojaId, lojaNome: process.env.LOJA_NOME || 'Catálogo', lojaWhatsapp: process.env.LOJA_WHATSAPP || '', lojaLogo: process.env.LOJA_LOGO || process.env.LOJA_NOME?.trim().charAt(0).toUpperCase() || 'A' };
}
export default async function handler(req, res) {
  try {
    const env = envConfig();
    if (!env.lojaId) {
      if (req.method === 'GET') return res.status(200).json(env);
      return res.status(400).json({ erro: 'Configure a variável LOJA_ID na Vercel antes de salvar a loja.' });
    }
    const source = '__LOJA_CONFIG__:' + env.lojaId;
    if (req.method === 'GET') {
      const rows = await db('?source_url=eq.' + encodeURIComponent(source) + '&limit=1');
      const row = rows?.[0];
      if (!row) return res.status(200).json(env);
      return res.status(200).json({ lojaId: env.lojaId, lojaNome: row.nome || env.lojaNome, lojaWhatsapp: row.descricao || env.lojaWhatsapp, lojaLogo: row.imagem || env.lojaLogo });
    }
    if (req.method !== 'PATCH') return res.status(405).end();
    if (!autorizado(req)) return res.status(401).json({ erro: 'Senha incorreta' });
    const body = req.body || {};
    const lojaNome = String(body.lojaNome || '').trim().slice(0, 160);
    const lojaWhatsapp = String(body.lojaWhatsapp || '').trim().slice(0, 40);
    const lojaLogo = String(body.lojaLogo || '').trim().slice(0, 2000);
    if (!lojaNome) return res.status(400).json({ erro: 'Nome da loja é obrigatório.' });
    if (!lojaWhatsapp) return res.status(400).json({ erro: 'WhatsApp da loja é obrigatório.' });
    const row = { source_url: source, nome: lojaNome.toUpperCase(), categoria: '__LOJA_CONFIG__', descricao: lojaWhatsapp, imagem: lojaLogo, preco: null, atualizado_em: new Date().toISOString() };
    const rows = await db('?on_conflict=source_url', { method: 'POST', body: JSON.stringify(row) });
    const saved = rows?.[0] || row;
    return res.status(200).json({ lojaId: env.lojaId, lojaNome: saved.nome, lojaWhatsapp: saved.descricao, lojaLogo: saved.imagem || env.lojaLogo });
  } catch (e) { return res.status(500).json({ erro: 'Erro na configuração: ' + e.message }); }
}