export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const config = {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    SUPABASE_ROLE: process.env.SUPABASE_ROLE || "",
    INTERNAL_KEY: process.env.INTERNAL_KEY || "",
    WEBHOOK_URL: process.env.WEBHOOK_URL || ""
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error: `Thiếu Environment Variables: ${missing.join(", ")}`
    });
  }

  return res.status(200).json({
    ok: true,
    ...config
  });
}
