// /api/getConfig.js
export default function handler(req, res) {
  // ===== CORS cơ bản =====
  res.setHeader('Access-Control-Allow-Origin', '*'); // có thể siết domain khi deploy
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();


  // // ===== (Tuỳ chọn) Đọc từ ENV khi deploy =====
  const env = {
  url: process.env.SUPABASE_URL || '',
  anon: process.env.SUPABASE_ANON_KEY || '',
  role: process.env.SUPABASE_ANON_KEY
  webhookUrl: process.env.link_webhook || '',
  mapUrl: process.env.link_map_apps_script || '',
  mapSheet: process.env.sheet_id_map || '',
  mapSecret: process.env.MAP_SHARED_SECRET || '',
  };

  if (!env.url || !env.anon) {
    return res.status(500).json({ error: 'Thiếu Supabase config' });
  }


  return res.status(200).json({
    url: env.url,
    anon: env.anon,
    role: env.role,
    webhookUrl: env.webhookUrl,
    map: {
      APPS_URL: env.mapUrl,
      SHEET_ID: env.mapSheet,
      SHARED_SECRET: env.mapSecret,
      WEBHOOK_URL: env.webhookUrl,
    }
  });
}
