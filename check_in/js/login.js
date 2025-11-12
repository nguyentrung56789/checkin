// ===================== /js/login.js (no-import, robust) =====================
(function () {
  const $ = (id) => document.getElementById(id);
  const LS = window.localStorage;
  const SS = window.sessionStorage;

  const TABLE_NV = (window.COD_CONFIGS?.index?.table) || 'kv_nhan_vien';

  // ---- UI helpers
  function showMsg(t = '', ok = false) {
    const el = $('msg'); if (!el) return;
    el.textContent = t;
    el.style.color = ok ? '#22c55e' : '#ff6b6b';
  }
  function setBtn(disabled, text) {
    const b = $('btnLogin'); if (!b) return;
    b.disabled = !!disabled;
    if (text) b.textContent = text;
  }
  function getNextURL() {
    const u = new URL(location.href);
    return u.searchParams.get('next') || 'main.html';
  }
  function goMain() {
    try {
      const token = (typeof window.makeAccess === 'function') ? window.makeAccess() : '';
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      location.replace(`./${getNextURL().replace(/^\.\//,'')}${qs}`);
    } catch {
      location.replace(`./${getNextURL().replace(/^\.\//,'')}`);
    }
  }
  function safeParse(s, fb=null){ try{ return JSON.parse(s);}catch{ return fb;} }

  // ---- Auto redirect nếu đã có phiên hợp lệ
  (function autoRedirect() {
    const nv = safeParse(LS.getItem('nv'));
    if (nv && nv.ma_nv && nv.hoat_dong === true) {
      console.log('[login] found session → go main');
      goMain();
    }
  })();

  // ---- ensure internal_key.js
  function loadScript(src){
    return new Promise((res, rej)=>{
      const s=document.createElement('script');
      s.src=src; s.onload=()=>res(src); s.onerror=()=>rej(new Error('load fail '+src));
      document.head.appendChild(s);
    });
  }
  async function ensureInternalKey(){
    if (typeof window.getConfig === 'function') return 'preloaded';
    const tries = ['js/internal_key.js','../js/internal_key.js','/js/internal_key.js'];
    for (const p of tries){
      try{ await loadScript(p); if (typeof window.getConfig==='function') return p; }catch{}
    }
    return null;
  }

  // ---- fetch with timeout
  async function fetchWithTimeout(url, opts={}, ms=1500){
    const c = new AbortController();
    const t = setTimeout(()=>c.abort(), ms);
    try { return await fetch(url, { ...opts, signal: c.signal }); }
    finally { clearTimeout(t); }
  }

  // ---- resolve config
  async function resolveConfig(){
    let url, anon, source = '';

    // 1) /api/getConfig (có timeout)
    try{
      const r = await fetchWithTimeout('/api/getConfig', {
        headers: { 'x-internal-key': (window.getInternalKey?.()||'') }
      }, 1500);
      if (r && r.ok){
        const j = await r.json();
        if (j?.url && j?.anon){ url=j.url; anon=j.anon; source='api/getConfig'; }
      }
    }catch{/* timeout/abort -> bỏ qua */}

    // 2) getConfig('url'|'anon')
    if (!url || !anon){
      if (typeof window.getConfig === 'function'){
        const u1 = window.getConfig('url');
        const a1 = window.getConfig('anon');
        if (u1 && a1){ url=u1; anon=a1; source='getConfig(key)'; }
      }
    }

    // 3) COD_BASE fallback
    if (!url || !anon){
      url  = window.COD_BASE?.url  || url;
      anon = window.COD_BASE?.anon || anon;
      if (url && anon && !source) source='COD_BASE';
    }

    return { url, anon, source };
  }

  // ---- init supabase
  let supabase = null;
  async function init(){
    const note = $('cfgNote');
    note && (note.textContent = 'Đang khởi tạo cấu hình…');
    setBtn(false, 'Đăng nhập'); // luôn bật nút

    const where = await ensureInternalKey();
    if (!where){
      showMsg('Không tìm thấy internal_key.js (sai đường dẫn?)');
      note && (note.textContent='⚠️ Thiếu cấu hình Supabase (internal_key.js).');
      return;
    }

    const { url, anon, source } = await resolveConfig();
    if (!url || !anon){
      showMsg('Thiếu cấu hình Supabase (url/anon)');
      note && (note.textContent='Không khởi tạo được Supabase.');
      return;
    }

    if (!window.supabase){
      showMsg('Thiếu @supabase/supabase-js@2');
      note && (note.textContent='⚠️ Chưa nạp thư viện Supabase.');
      return;
    }

    const xKey = (typeof window.getInternalKey === 'function') ? window.getInternalKey() : undefined;
    supabase = window.supabase.createClient(url, anon, {
      auth: { persistSession:false },
      global: { headers: xKey ? { 'x-internal-key': xKey } : {} }
    });

    note && (note.textContent = `Đã sẵn sàng (${source||'local'}). Vui lòng đăng nhập.`);
    console.log('[login] supabase ready via', source, '→', url);
  }

  // ---- login flow
  let logging = false;
  async function doLogin(){
    if (logging) return;
    if (!supabase){ showMsg('Đang khởi tạo, vui lòng thử lại…'); return; }

    const ma = ($('ma_nv')?.value||'').trim();
    const mk = ($('mat_khau')?.value||'').trim();
    if (!ma || !mk){ showMsg('Vui lòng nhập đủ thông tin'); return; }

    logging = true; setBtn(true, 'Đang xử lý…'); showMsg('');
    try{
      const { data, error } = await supabase
        .from(TABLE_NV)
        .select('ma_nv, ten_nv, admin, dong_hang, check_don, map, hoat_dong')
        .eq('ma_nv', ma)
        .eq('mat_khau', mk.toString())
        .maybeSingle();

      if (error){ console.error(error); showMsg('Không truy vấn được bảng nhân viên.'); return; }
      if (!data){ showMsg('Sai mã hoặc mật khẩu'); return; }
      if (data.hoat_dong !== true){ showMsg('Tài khoản đã bị dừng hoạt động.'); return; }

      // lưu phiên
      try{
        LS.setItem('nv', JSON.stringify(data));
        LS.setItem('last_ma_nv', ma);
        SS.setItem('nv_ctx', JSON.stringify({ ma_nv:data.ma_nv||'', ten_nv:data.ten_nv||'', ts:Date.now() }));
      }catch(e){ console.error(e); showMsg('Không thể lưu phiên đăng nhập.'); return; }

      navigator.vibrate && navigator.vibrate(60);
      showMsg('Đăng nhập thành công.', true);
      goMain();
    }catch(e){
      console.error('[login] fatal', e);
      showMsg('Lỗi: '+e.message);
    }finally{
      logging = false; setBtn(false, 'Đăng nhập');
    }
  }

  // ---- bind UI
  function bindEvents(){
    $('btnLogin')?.addEventListener('click', doLogin);
    $('mat_khau')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
    const el = $('ma_nv'); if (el) el.value = LS.getItem('last_ma_nv') || '';
  }

  // nếu DOM chưa sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bindEvents(); init(); });
  } else {
    bindEvents(); init();
  }
})();
