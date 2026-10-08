export default async function handler(req, res) {
  const lojaId = process.env.LOJA_ID || '';
  const lojaNome = process.env.LOJA_NOME || 'Catálogo';
  const lojaWhatsapp = process.env.LOJA_WHATSAPP || '';
  const lojaLogo = process.env.LOJA_LOGO || lojaNome.trim().charAt(0).toUpperCase() || 'A';

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ lojaId, lojaNome, lojaWhatsapp, lojaLogo });
}
