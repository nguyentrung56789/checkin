// ===================== cod_config.js =====================


// 1) CẤU HÌNH THEO ỨNG DỤNG
window.COD_CONFIGS = {
  index: { table: "kv_nhan_vien" },        // index.html (đăng nhập)
  cod:   { table: "don_hang_kiot_cod" },   // Quan_ly_COD.html
  check: { table: "don_hang" }             // check_don.html
};

// 2) HÀM TRỘN CẤU HÌNH
window.getConfig = (name) => {
  const base = window.COD_BASE || {};
  const per  = (window.COD_CONFIGS || {})[name] || {};
  return { ...base, ...per }; // {url, key, table}
};
