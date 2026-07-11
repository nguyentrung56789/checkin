// ======================== internal_key.js ========================

// 1️⃣ Khóa nội bộ (header x-internal-key)
window.getInternalKey = () => "Trung@123";

// 2️⃣ Cấu hình LOCAL Supabase (offline test + role key)
const LOCAL_SUPABASE_CONFIG = {
  url: "https://cywtgdtsxajczljspwxe.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5d3RnZHRzeGFqY3psanNwd3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MzI1NjQsImV4cCI6MjA3MjMwODU2NH0.FZ6z6kfUWyf8l7WnA5J1wkrAy7KjpU6VT65EdyXCka8",

  // ⚠️ Role key chỉ dùng nội bộ để test local (KHÔNG deploy public)
  role: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5d3RnZHRzeGFqY3psanNwd3hlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjczMjU2NCwiZXhwIjoyMDcyMzA4NTY0fQ.z0re_7rP4COpMNARZ1-8U9bwF9bwH8YQOePYyHWMGto"
};

// 3️⃣ Cấu hình MAP (Apps Script + Sheet)
const LOCAL_APP_MAP = {
  APPS_URL: "https://script.google.com/macros/s/AKfycbxvwPYBOGUyex1ZOgM3E4g2sKMcz3QLao8DaiZz4oRJmnMOwFdF0M30fQD_QR2ubzcK/exec",
  SHEET_ID: "18YC3kOwKLLvbzYeuXbZ-5U348EV_hAY2Y3wdot42P1c",
  SHARED_SECRET: "t12345",
  CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQFLOQCFAQqdcQLP4Yxy0IAVk2f1GCs3nTpEdrITr5s47wOAdViQ3K0VkcQLQSRoLehUe8jFfXrvjkm/pub?output=csv",
};

// 4️⃣ Webhook nội bộ (ẩn khỏi body JSON)
const LOCAL_WEBHOOK = process.env.WEBHOOK_URL;

// 5️⃣ Cấu hình hệ thống dọn rác (cleanup)
const LOCAL_CLEANUP_CONFIG = {
  ENABLED: true,        // 🔧 Bật/tắt tính năng dọn rác
  MONTH_LIMIT: 0.23,    // 🔧 Xóa dữ liệu cũ hơn N tháng (~7 ngày)
  AUTO_RUN_HOUR: 3,     // ⏰ Nếu sau này bạn muốn cron tự chạy (3h sáng)
};

// 6️⃣ Hàm lấy cấu hình dùng chung
window.getConfig = function (key) {
  switch (key) {
    case "url": return LOCAL_SUPABASE_CONFIG.url;
    case "anon": return LOCAL_SUPABASE_CONFIG.anon;
    case "role": return LOCAL_SUPABASE_CONFIG.role;   // 👈 thêm để test local
    case "webhook": return LOCAL_WEBHOOK;
    case "map": return LOCAL_APP_MAP;
    case "cleanup": return LOCAL_CLEANUP_CONFIG;
    case "render_api": return `${location.origin}/api_render/render.png`; // API render PNG
    default: return null;
  }
};

// 7️⃣ Cho phép script khác truy cập nhanh config cleanup
window.getConfigCleanup = () => LOCAL_CLEANUP_CONFIG;

// 8️⃣ Interceptor fetch: fallback cho /api/getConfig
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
        url: LOCAL_SUPABASE_CONFIG.url,
        anon: LOCAL_SUPABASE_CONFIG.anon,
        role: LOCAL_SUPABASE_CONFIG.role,
        map: LOCAL_APP_MAP,
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
