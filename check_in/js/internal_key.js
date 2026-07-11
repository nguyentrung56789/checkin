/* =========================================================
   INTERNAL CONFIG
   Lấy cấu hình từ Vercel Environment Variables
   thông qua /api/getConfig
========================================================= */

(() => {
  let configCache = null;
  let loadingPromise = null;

  window.getConfig = async function getConfig() {
    if (configCache) {
      return configCache;
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = (async () => {
      const response = await fetch("/api/getConfig", {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      });

      const responseText = await response.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `/api/getConfig không trả về JSON. HTTP ${response.status}`
        );
      }

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
          data.message ||
          `Không tải được cấu hình. HTTP ${response.status}`
        );
      }

      configCache = {
        SUPABASE_URL: data.SUPABASE_URL,
        SUPABASE_ANON_KEY: data.SUPABASE_ANON_KEY,
        SUPABASE_ROLE: data.SUPABASE_ROLE,
        INTERNAL_KEY: data.INTERNAL_KEY,
        WEBHOOK_URL: data.WEBHOOK_URL
      };

      // Biến cấu hình tổng
      window.APP_CONFIG = configCache;

      // Giữ tương thích với code cũ
      window.LOCAL_SUPABASE_CONFIG = {
        url: configCache.SUPABASE_URL,
        anon: configCache.SUPABASE_ANON_KEY,
        role: configCache.SUPABASE_ROLE
      };

      // Hàm lấy internal key
      window.getInternalKey = function () {
        return configCache.INTERNAL_KEY;
      };

      // Webhook
      window.LOCAL_WEBHOOK = configCache.WEBHOOK_URL;

      return configCache;
    })();

    try {
      return await loadingPromise;
    } finally {
      loadingPromise = null;
    }
  };
})();
