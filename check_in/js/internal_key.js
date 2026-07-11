// ======================== internal_key.js ========================

// 1️⃣ Khóa nội bộ (header x-internal-key)
window.getInternalKey = () => "Trung@123";

// 2️⃣ Cấu hình LOCAL Supabase (offline test + role key)
const LOCAL_SUPABASE_CONFIG = {
  url:  "",
  anon: "",
  role: ""
};

// 3️⃣ Cấu hình MAP (Apps Script + Sheet) — key phẳng
const LOCAL_APP_MAP = {
  apps_url:      "",
  sheet_id:      "",
  shared_secret: "",
  csv_url:       ""    // có thể điền sẵn link CSV để fallback khi server không trả về
};

// 4️⃣ Webhook nội bộ (ẩn khỏi body JSON)
// ⚠️ PHẢI là let để có thể cập nhật từ /api/getConfig
let LOCAL_WEBHOOK = "";

// 5️⃣ Cấu hình hệ thống dọn rác (cleanup)
const LOCAL_CLEANUP_CONFIG = {
  ENABLED: true,        // 🔧 Bật/tắt tính năng dọn rác
  MONTH_LIMIT: 0.23,    // 🔧 Xóa dữ liệu cũ hơn N tháng (~7 ngày)
  AUTO_RUN_HOUR: 3      // ⏰ Nếu sau này bạn muốn cron tự chạy (3h sáng)
};

// 6️⃣ Hàm lấy cấu hình dùng chung (trả về theo key phẳng)
window.getConfig = function (key) {
  switch (key) {
    case "url":           return LOCAL_SUPABASE_CONFIG.url;
    case "anon":          return LOCAL_SUPABASE_CONFIG.anon;
    case "role":          return LOCAL_SUPABASE_CONFIG.role;
    case "webhook":       return LOCAL_WEBHOOK;

    // MAP (phẳng)
    case "apps_url":      return LOCAL_APP_MAP.apps_url;
    case "sheet_id":      return LOCAL_APP_MAP.sheet_id;
    case "shared_secret": return LOCAL_APP_MAP.shared_secret;
    case "csv_url":       return LOCAL_APP_MAP.csv_url;

    case "cleanup":       return LOCAL_CLEANUP_CONFIG;
    case "render_api":    return `${location.origin}/api_render/render.png`;
    default:              return null;
  }
};

// 7️⃣ Cho phép script khác truy cập nhanh config cleanup
window.getConfigCleanup = () => LOCAL_CLEANUP_CONFIG;

// 8️⃣ Interceptor fetch: fallback cho /api/getConfig (nếu server down → trả về LOCAL)
(function patchFetchForGetConfig() {
  const origFetch = window.fetch?.bind(window);

  async function tryRealGetConfig(input, init) {
    if (!origFetch) return null;
    try {
      const resp = await origFetch(input, init);
      return (resp && resp.ok) ? resp : null;
    } catch { return null; }
  }

  function isGetConfigURL(u) {
    try {
      const url = (typeof u === 'string')
        ? new URL(u, location.origin)
        : new URL(u.url, location.origin);
      return url.pathname === '/api/getConfig';
    } catch {
      return (typeof u === 'string') &&
             (u === '/api/getConfig' || u.endsWith('/api/getConfig'));
    }
  }

  window.fetch = async function (input, init) {
    if (isGetConfigURL(input)) {
      const real = await tryRealGetConfig(input, init);
      if (real) return real;

      // Fallback local (không gửi webhook ra ngoài)
      const body = JSON.stringify({
        url:  LOCAL_SUPABASE_CONFIG.url,
        anon: LOCAL_SUPABASE_CONFIG.anon,
        role: LOCAL_SUPABASE_CONFIG.role,

        // MAP (phẳng)
        apps_url:      LOCAL_APP_MAP.apps_url,
        sheet_id:      LOCAL_APP_MAP.sheet_id,
        shared_secret: LOCAL_APP_MAP.shared_secret,
        csv_url:       LOCAL_APP_MAP.csv_url,

        // Giữ đúng tên field server đang trả
        webhookUrl: LOCAL_WEBHOOK,

        cleanup: LOCAL_CLEANUP_CONFIG
      });

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!origFetch) throw new Error("fetch not available");
    return origFetch(input, init);
  };
})();

// 9️⃣ Nạp cấu hình runtime từ server (nếu có) rồi ghi vào LOCAL_*
window.configReady = (async () => {
  try {
    const resp = await fetch("/api/getConfig", {
      headers: { "x-internal-key": window.getInternalKey?.() || "" }
    });
    if (!resp.ok) throw new Error("getConfig failed: " + resp.status);
    const cfg = await resp.json();

    // Supabase
    if (cfg.url)  LOCAL_SUPABASE_CONFIG.url  = cfg.url;
    if (cfg.anon) LOCAL_SUPABASE_CONFIG.anon = cfg.anon;
    if (cfg.role) LOCAL_SUPABASE_CONFIG.role = cfg.role;

    // MAP (phẳng)
    if (cfg.apps_url)      LOCAL_APP_MAP.apps_url      = cfg.apps_url;
    if (cfg.sheet_id)      LOCAL_APP_MAP.sheet_id      = cfg.sheet_id;
    if (cfg.shared_secret) LOCAL_APP_MAP.shared_secret = cfg.shared_secret;
    if (cfg.csv_url)       LOCAL_APP_MAP.csv_url       = cfg.csv_url;

    // 🔔 Webhook (tên field từ server: webhookUrl)
    if (cfg.webhookUrl)    LOCAL_WEBHOOK = cfg.webhookUrl;

    // Cleanup (nếu có)
    if (cfg.cleanup && typeof cfg.cleanup === 'object') {
      Object.assign(LOCAL_CLEANUP_CONFIG, cfg.cleanup);
    }
  } catch (e) {
    console.warn("Không lấy được /api/getConfig — dùng LOCAL fallback:", e);
  }
})();

// 🔧 Tiện ích kiểm tra nhanh (tuỳ chọn)
window.dumpConfig = () => ({
  url: window.getConfig('url'),
  anon: window.getConfig('anon'),
  role: window.getConfig('role'),
  apps_url: window.getConfig('apps_url'),
  sheet_id: window.getConfig('sheet_id'),
  csv_url: window.getConfig('csv_url'),
  webhook: window.getConfig('webhook'),
  cleanup: window.getConfig('cleanup')
});
window.pingWebhook = async () => {
  const u = window.getConfig('webhook');
  if (!u) { alert('Thiếu webhook'); return false; }
  const r = await fetch(u, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'ping'})});
  alert(r.ok ? '✅ Webhook OK' : ('❌ Webhook lỗi ' + r.status));
  return r.ok;
};
