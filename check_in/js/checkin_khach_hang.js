async function getSupabaseLib(){
  if (window.supabase?.createClient) return window.supabase;
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  return mod;
}

(async () => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  if (!document.getElementById('btn-danger-style')){
    const style = document.createElement('style');
    style.id = 'btn-danger-style';
    style.textContent = `
      .btn-danger{background:#ef4444;color:#fff}
      .btn-danger:hover{filter:brightness(1.08)}
    `;
    document.head.appendChild(style);
  }

  const toast = (msg,t='')=>{
    const el = $('#toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = 'block';
    el.style.borderColor =
      t==='err' ? '#ef4444' :
      t==='ok'  ? '#22c55e' :
                  '#243153';
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>el.style.display='none',2200);
  };

  function escAttr(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;')
      .replace(/</g,'&lt;');
  }

  function cssEscapeSafe(v){
    try{
      return CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g,'\\"');
    }catch{
      return String(v).replace(/"/g,'\\"');
    }
  }

  const TABLE = 'nv_checkin_khach_hang';
  const CHECKIN_TABLE = 'nv_checkin';
  const CHECKIN_DATE_COL = 'ngay';
  const SESSION_IMG_KEY = 'CHECKIN_IMAGE_PAYLOAD';
  const CHECKIN_BROWSER_DONE_KEY = 'CHECKIN_BROWSER_DONE_V1';

  let SB = null;
  let CURRENT = null;
  let saveBusy = false;
  let checkinBusy = false;
  const pendingCheckins = new Set();

  function isBrowserCheckinDone(){
    return sessionStorage.getItem(CHECKIN_BROWSER_DONE_KEY) === '1';
  }

  function setBrowserCheckinDone(){
    try{ sessionStorage.setItem(CHECKIN_BROWSER_DONE_KEY, '1'); }catch{}
  }

  function clearBrowserCheckinDone(){
    try{ sessionStorage.removeItem(CHECKIN_BROWSER_DONE_KEY); }catch{}
  }

  function getLatLngFromURL(){
    const qp = new URLSearchParams(location.search);
    const latRaw = qp.get('lat') ?? qp.get('latitude');
    const lngRaw = qp.get('lng') ?? qp.get('long') ?? qp.get('lon') ?? qp.get('longitude');
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }

  function initRadiusFromURLOrDefault(){
    const sel = $('#radiusSelect');
    if (!sel) return;

    const qp = new URLSearchParams(location.search);
    let r = Number(qp.get('radius'));
    const rkm = Number(qp.get('radius_km'));

    if (Number.isFinite(rkm) && rkm > 0) r = rkm * 1000;
    if (!Number.isFinite(r) || r <= 0) r = 50;

    sel.value = [20,50,100,500].includes(Math.round(r))
      ? String(Math.round(r))
      : '50';
  }

  function getRadiusFromUI(){
    const v = Number($('#radiusSelect')?.value);
    return Number.isFinite(v) && v > 0 ? v : 50;
  }

  function buildShortAddress(a){
    const soNhaDuong = [
      a.house_number || '',
      a.road || a.pedestrian || a.footway || a.street || ''
    ].filter(Boolean).join(' ').trim();

    return [
      soNhaDuong,
      a.quarter || ''
    ].filter(Boolean).join(', ');
  }

  async function getAddressFromLatLng(){
    const coords = getLatLngFromURL();
    if (!coords) return null;

    try{
      const url =
        'https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
        `&lat=${encodeURIComponent(coords.lat)}` +
        `&lon=${encodeURIComponent(coords.lng)}` +
        '&accept-language=vi';

      const res = await fetch(url, { cache:'no-store' });
      if (!res.ok) return null;

      const data = await res.json();
      const a = data.address || {};

      const parts = String(data.display_name || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);

      const dia_chi =
        buildShortAddress(a) ||
        parts[0] ||
        '';

      const phuong_xa =
        a.city ||
        parts.find(x => /^Phường\s+/i.test(x)) ||
        '';

      const thanh_pho =
        a.state ||
        a.province ||
        parts.find(x =>
          /Hải Phòng|Hà Nội|Đà Nẵng|Hồ Chí Minh|Cần Thơ/i.test(x)
        ) ||
        '';

      return {
        dia_chi,
        phuong_xa,
        thanh_pho
      };
    }catch(err){
      console.warn('Không lấy được địa chỉ từ tọa độ:', err);
      return null;
    }
  }

  function getLoggedNV(){
    try{
      const s = sessionStorage.getItem('nv_ctx');
      if (s){
        const o = JSON.parse(s);
        if (o?.ma_nv) return o;
      }
    }catch{}

    try{
      const s2 = localStorage.getItem('nv');
      if (s2){
        const o2 = JSON.parse(s2);
        if (o2?.ma_nv) return o2;
      }
    }catch{}

    return null;
  }

  function getCurrentNVID(){
    return getLoggedNV()?.ma_nv ? String(getLoggedNV().ma_nv) : null;
  }

  function getUrlEmployee(){
    const qp = new URLSearchParams(location.search);
    return {
      ma_nv: String(qp.get('ma_nv') || '').trim(),
      ten_nv: String(qp.get('ten_nv') || '').trim()
    };
  }

  function blockPage(message, url){
    try{ alert(message); }catch{}
    location.replace(url);
    throw new Error(message);
  }

  function requireMatchedEmployee(){
    const fromUrl = getUrlEmployee();
    const logged = getLoggedNV();

    if (!fromUrl.ma_nv){
      blockPage('Thiếu mã nhân viên. Vui lòng vào từ Trang chính.', './main.html');
    }

    if (!logged || !logged.ma_nv || logged.hoat_dong === false){
      blockPage('Bạn chưa đăng nhập.', './login.html');
    }

    if (String(logged.ma_nv) !== String(fromUrl.ma_nv)){
      blockPage('Mã nhân viên không khớp tài khoản đăng nhập.', './main.html');
    }

    return {
      ma_nv: fromUrl.ma_nv,
      ten_nv: fromUrl.ten_nv || logged.ten_nv || ''
    };
  }

  const AUTH_NV = requireMatchedEmployee();

  function getImagePayloadFromSession(){
    try{
      const raw = sessionStorage.getItem(SESSION_IMG_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && typeof p.image_b64 === 'string' && p.image_b64.length > 0) return p;
    }catch{}
    return null;
  }

  function getTodayPrefix_ddMMyyyy(){
    const d = new Date();
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function isSameTodayFromText(v){
    const s = String(v || '').trim();
    return !!s && s.startsWith(getTodayPrefix_ddMMyyyy());
  }

  function getCheckinTodayState(rows){
    const all = Array.isArray(rows) ? rows : [];
    let disabledCount = 0;

    const mapped = all.map(r => {
      const checkedToday = isSameTodayFromText(r.ngay_cuoi_cung_checkin);
      if (checkedToday) disabledCount++;
      return { ...r, checkedToday };
    });

    return { rows: mapped, disabledCount };
  }

  function applyCheckedTodayLock(){
    const btnAdd = $('#btnAdd');
    if (btnAdd){
      btnAdd.classList.remove('btn-disabled');
      btnAdd.disabled = false;
    }

    $$('#tbody .btn-edit').forEach(b=>{
      b.classList.remove('btn-disabled');
      b.disabled = false;
    });
  }

  async function loadCheckedToday(){
    const ma_nv = getCurrentNVID();
    if (!ma_nv) return false;

    const todayPrefix = getTodayPrefix_ddMMyyyy();

    try{
      const { data, error } = await SB
        .from(CHECKIN_TABLE)
        .select(`ma_nv, ${CHECKIN_DATE_COL}`)
        .eq('ma_nv', ma_nv)
        .like(CHECKIN_DATE_COL, todayPrefix + '%')
        .limit(1);

      if (error){
        console.warn('nv_checkin bị chặn quyền/RLS:', error.message || error);
        return false;
      }

      return Array.isArray(data) && data.length > 0;
    }catch(err){
      console.warn('Lỗi đọc nv_checkin:', err);
      return false;
    }
  }

  function getWebhookURL(){
    return 'https://dhsybbqoe.datadex.vn/webhook/hoadon';
  }

  async function postWebhook(payload){
    const url = getWebhookURL();
    const headers = { 'content-type':'application/json' };

    try{
      if (typeof getInternalKey === 'function'){
        headers['x-internal-key'] = getInternalKey();
      }
    }catch{}

    try{
      const res = await fetch(url, {
        method:'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const text = await res.text().catch(()=> '');
      if (res.ok) return { ok:true, status:res.status, text };
      if (res.status !== 405) return { ok:false, status:res.status, text };
    }catch(e){}

    const qs = new URLSearchParams(
      Object.entries(payload).map(([k,v])=>[k, String(v ?? '')])
    ).toString();

    const getUrl = url + (url.includes('?') ? '&' : '?') + qs;

    try{
      const res2 = await fetch(getUrl, {
        method:'GET',
        headers: { 'x-internal-key': headers['x-internal-key'] || '' }
      });

      const text2 = await res2.text().catch(()=> '');
      return { ok: res2.ok, status: res2.status, text: text2 };
    }catch(e2){
      return { ok:false, status:0, text:String(e2) };
    }
  }

  function openModal(mode,row=null){
    CURRENT = { mode };
    $('#modalTitle').textContent = mode === 'add' ? 'Thêm khách hàng' : 'Sửa khách hàng';

    const maKhRow = $('#maKhRow');
    if (maKhRow) maKhRow.style.display = 'none';

    if ($('#f_ma_kh')) $('#f_ma_kh').disabled = mode === 'edit';

    if (mode === 'edit' && row){
      $('#f_ma_kh').value      = row.ma_kh || '';
      $('#f_ten_kh').value     = row.ten_kh || '';
      $('#f_dia_chi').value    = row.dia_chi || '';
      $('#f_phuong_xa').value  = row.phuong_xa || '';
      $('#f_thanh_pho').value  = row.thanh_pho || '';
      $('#f_dien_thoai').value = row.dien_thoai || '';
      CURRENT.ma_kh = row.ma_kh;
    }else{
      $('#f_ma_kh').value      = '';
      $('#f_ten_kh').value     = '';
      $('#f_dia_chi').value    = '';
      $('#f_phuong_xa').value  = '';
      $('#f_thanh_pho').value  = '';
      $('#f_dien_thoai').value = '';

      const hint = $('#modalHint');
      if (hint) hint.textContent = 'Đang lấy địa chỉ theo tọa độ ảnh chụp...';

      getAddressFromLatLng().then(info => {
        if (CURRENT?.mode !== 'add') return;

        if (!info){
          const hint2 = $('#modalHint');
          if (hint2) hint2.textContent = 'Không lấy được địa chỉ, nhập tay rồi lưu';
          return;
        }

        if (!$('#f_dia_chi').value)    $('#f_dia_chi').value    = info.dia_chi || '';
        if (!$('#f_phuong_xa').value)  $('#f_phuong_xa').value  = info.phuong_xa || '';
        if (!$('#f_thanh_pho').value)  $('#f_thanh_pho').value  = info.thanh_pho || '';

        const hint2 = $('#modalHint');
        if (hint2) hint2.textContent = 'Đã lấy địa chỉ theo tọa độ ảnh chụp';
      });
    }

    $('#modalWrap').style.display = 'flex';
  }

  const closeModal = () => $('#modalWrap').style.display = 'none';

async function makeClient(){
  const url  = getConfig('url');
  const anon = getConfig('anon');
  const lib  = await getSupabaseLib();

  return lib.createClient(url, anon, {
    auth: {
      persistSession: false
    }
  });
}

  async function loadData(){
    $('#tbody').innerHTML = `<tr><td colspan="4" class="muted">Đang tải...</td></tr>`;

    const { data, error } = await SB
      .from(TABLE)
      .select('ma_kh,ten_kh,dia_chi,phuong_xa,thanh_pho,dien_thoai,ngay_cuoi_cung_checkin',{count:'exact'})
      .order('ten_kh',{ascending:true})
      .limit(500);

    if (error){
      console.error(error);
      $('#tbody').innerHTML =
        `<tr><td colspan="4" class="muted">Lỗi Supabase: ${error.message}</td></tr>`;
      return;
    }

    const { rows, disabledCount } = getCheckinTodayState(data || []);

    $('#countInfo').textContent =
      `${rows.length} dòng` + (disabledCount ? ` • Disable ${disabledCount} KH đã check-in hôm nay` : '');

    renderRows(rows);
  }

  function renderRows(rows){
    if (!rows.length){
      $('#tbody').innerHTML =
        `<tr><td colspan="4" class="muted">Không có dữ liệu</td></tr>`;
    } else {
      const html = rows.map(r => {
        const disabledByCustomer = r.checkedToday === true;
        const disabledByBrowser = isBrowserCheckinDone();
        const disabled = disabledByCustomer || disabledByBrowser;

        const title = disabledByCustomer
          ? 'Khách này đã check-in hôm nay'
          : disabledByBrowser
            ? 'Trình duyệt này đã gửi check-in, cần chụp ảnh mới để check-in tiếp'
            : '';

        const btnHtml = disabled
          ? `<button class="ma-kh-btn ma-kh-disabled" disabled title="${escAttr(title)}">${escAttr(r.ma_kh)}</button>`
          : `<button class="ma-kh-btn" data-id="${escAttr(r.ma_kh)}">${escAttr(r.ma_kh)}</button>`;

        return `
      <tr data-id="${escAttr(r.ma_kh)}"
          data-ten_kh="${escAttr(r.ten_kh||'')}"
          data-dia_chi="${escAttr(r.dia_chi||'')}"
          data-phuong_xa="${escAttr(r.phuong_xa||'')}"
          data-thanh_pho="${escAttr(r.thanh_pho||'')}"
          data-dien_thoai="${escAttr(r.dien_thoai||'')}"
          data-ngay_cuoi_cung_checkin="${escAttr(r.ngay_cuoi_cung_checkin||'')}">
        <td class="col-ma">${btnHtml}</td>
        <td class="col-ten">
          ${r.ten_kh || ''}
          ${disabledByCustomer ? `<span class="muted"> • Đã check-in hôm nay</span>` : ``}
        </td>
        <td class="col-phone">${r.dien_thoai || ''}</td>
        <td class="col-actions">
           <button class="btn btn-warn btn-edit">Sửa</button>
  <button class="btn btn-danger btn-delete" data-id="${escAttr(r.ma_kh)}">Xóa</button>
        </td>
      </tr>`;
      }).join('');

      $('#tbody').innerHTML = html;
    }

    $$('#tbody .btn-edit').forEach(b =>
      b.addEventListener('click', onEditClick)
    );

    $$('#tbody .btn-delete').forEach(b =>
      b.addEventListener('click', () => onDeleteClick(b.dataset.id))
    );

    $$('#tbody .ma-kh-btn:not(.ma-kh-disabled)').forEach(b =>
      b.addEventListener('click', () => onMaKHClick(b.dataset.id))
    );

    applyCheckedTodayLock();
  }

  function onEditClick(e){
    const tr = e.target.closest('tr');
    if (!tr) return;

    const row = {
      ma_kh:      tr.getAttribute('data-id'),
      ten_kh:     tr.dataset.ten_kh || tr.children[1].textContent,
      dia_chi:    tr.dataset.dia_chi || '',
      phuong_xa:  tr.dataset.phuong_xa || '',
      thanh_pho:  tr.dataset.thanh_pho || '',
      dien_thoai: tr.dataset.dien_thoai || tr.children[2].textContent
    };

    openModal('edit', row);
  }

  async function onMaKHClick(ma_kh){
    if (!ma_kh) return;

    if (isBrowserCheckinDone()) {
      toast('Đã gửi check-in trên trình duyệt này. Hãy chụp ảnh mới để check-in tiếp.', 'info');
      return;
    }

    if (checkinBusy) {
      toast('Đang gửi check-in, vui lòng chờ...', 'info');
      return;
    }

    if (pendingCheckins.has(ma_kh)) {
      toast('Check-in này đang được xử lý...', 'info');
      return;
    }

    const coords = getLatLngFromURL();
    if (!coords){
      toast('Thiếu toạ độ lat/lng trong URL — không thể checkin', 'err');
      return;
    }

    checkinBusy = true;
    pendingCheckins.add(ma_kh);
    setBrowserCheckinDone();

    const currentBtn = document.querySelector(`.ma-kh-btn[data-id="${cssEscapeSafe(ma_kh)}"]`);

    $$('#tbody .ma-kh-btn:not(.ma-kh-disabled)').forEach(btn=>{
      btn.disabled = true;
      btn.classList.add('ma-kh-disabled');
      btn.title = 'Đang có check-in được gửi...';
    });

    if (currentBtn){
      currentBtn.textContent = 'Đang gửi...';
      currentBtn.removeAttribute('data-id');
      currentBtn.title = 'Đang gửi check-in...';
    }

    const img = getImagePayloadFromSession();

    try{
      const payload = {
        action: 'checkin',
        ma_kh,
        ma_nv:  AUTH_NV.ma_nv,
        ten_nv: AUTH_NV.ten_nv || null,
        lat: Number(coords.lat),
        lng: Number(coords.lng),
        image_mime: img?.image_mime || 'image/jpeg',
        image_b64:  img?.image_b64  || ''
      };

      const res = await postWebhook(payload);

      if (res.ok){
        toast(`✅ ĐÃ CHECK IN KH: ${ma_kh}`,'ok');

        if (currentBtn){
          currentBtn.disabled = true;
          currentBtn.classList.add('ma-kh-disabled');
          currentBtn.textContent = ma_kh;
          currentBtn.removeAttribute('data-id');
          currentBtn.title = 'Đã gửi check-in';
        }

        setTimeout(() => {
          const coords2 = getLatLngFromURL();
          if (coords2) runNearby(coords2.lat, coords2.lng, getRadiusFromUI(), false);
          else loadData(false);
        }, 1200);
      } else {
        throw new Error(`Webhook lỗi ${res.status}: ${res.text?.slice(0,160)||'...'}`);
      }
    } catch(err){
      console.error(err);
      clearBrowserCheckinDone();

      $$('#tbody .ma-kh-btn.ma-kh-disabled').forEach(btn=>{
        const txt = btn.textContent.trim();

        if (txt === 'Đang gửi...') btn.textContent = ma_kh;

        btn.disabled = false;
        btn.classList.remove('ma-kh-disabled');
        btn.title = '';

        if (!btn.getAttribute('data-id')) {
          btn.setAttribute('data-id', txt === 'Đang gửi...' ? ma_kh : txt);
        }
      });

      toast(err.message || 'Gửi webhook thất bại','err');
    } finally {
      checkinBusy = false;
      pendingCheckins.delete(ma_kh);
    }
  }

  function generateMaKH(){
    const d = new Date();

    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');

    return `${AUTH_NV.ma_nv}_${yyyy}${MM}${dd}${hh}${mm}${ss}`;
  }

  async function checkMaKHExists(ma_kh){
    const { data, error } = await SB
      .from(TABLE)
      .select('ma_kh')
      .eq('ma_kh', ma_kh)
      .limit(1);

    if (error){
      console.error('Lỗi check mã KH:', error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  }

  async function onDeleteClick(ma_kh){
    if (!ma_kh) return;

    const ok = confirm(`Xóa khách hàng mã ${ma_kh}?`);
    if (!ok) return;

    const btn = document.querySelector(`.btn-delete[data-id="${cssEscapeSafe(ma_kh)}"]`);

    try{
      if (btn){
        btn.disabled = true;
        btn.textContent = 'Đang xóa...';
      }

      const { error } = await SB
        .from(TABLE)
        .delete()
        .eq('ma_kh', ma_kh);

      if (error){
        console.error(error);
        toast('Xóa thất bại: ' + error.message, 'err');

        if (btn){
          btn.disabled = false;
          btn.textContent = 'Xóa';
        }

        return;
      }

      toast(`Đã xóa ${ma_kh}`, 'ok');

const tr = document.querySelector(`tr[data-id="${cssEscapeSafe(ma_kh)}"]`);
if (tr) tr.remove();

const tbodyRows = $$('#tbody tr');

if (tbodyRows.length === 0) {
  $('#tbody').innerHTML =
    `<tr><td colspan="4" class="muted">Không có dữ liệu</td></tr>`;
}

const countInfo = $('#countInfo');
if (countInfo) {
  const oldText = countInfo.textContent || '';
  const m = oldText.match(/^(\d+)/);
  if (m) {
    const next = Math.max(0, Number(m[1]) - 1);
    countInfo.textContent = oldText.replace(/^\d+/, String(next));
  }
}
    }catch(err){
      console.error(err);
      toast('Xóa thất bại: ' + err.message, 'err');

      if (btn){
        btn.disabled = false;
        btn.textContent = 'Xóa';
      }
    }
  }

  async function saveForm(){
    if (saveBusy){
      toast('Đang lưu, vui lòng chờ...', 'info');
      return;
    }

    let ma_kh = $('#f_ma_kh').value.trim();

    const ten_kh     = $('#f_ten_kh').value.trim();
    const dia_chi    = $('#f_dia_chi').value.trim();
    const phuong_xa  = $('#f_phuong_xa').value.trim();
    const thanh_pho  = $('#f_thanh_pho').value.trim();
    const dien_thoai = $('#f_dien_thoai').value.trim();

    if (!ten_kh){
      toast('Tên khách hàng không được trống', 'err');
      return;
    }

    if (CURRENT?.mode === 'add'){
      if (!ma_kh){
        ma_kh = generateMaKH();
        $('#f_ma_kh').value = ma_kh;
      }

      const exists = await checkMaKHExists(ma_kh);
      if (exists){
        toast(`Mã KH ${ma_kh} đã tồn tại, bấm lưu lại lần nữa`, 'err');
        return;
      }
    } else {
      if (!ma_kh){
        toast('Mã KH không được trống', 'err');
        return;
      }
    }

    const coords = getLatLngFromURL();
    const lat = coords?.lat ?? null;
    const lng = coords?.lng ?? null;

    saveBusy = true;
    const btnSave = $('#btnSave');
    if (btnSave) btnSave.disabled = true;

    if (CURRENT?.mode === 'add'){
      const { error } = await SB
        .from(TABLE)
        .insert([{
          ma_kh,
          ma_nv: AUTH_NV.ma_nv,
          ten_nv: AUTH_NV.ten_nv || '',
          ten_kh,
          dia_chi,
          phuong_xa,
          thanh_pho,
          dien_thoai,
          lat,
          lng,
          con_hoat_dong: true
        }]);

      if (error){
        console.error(error);
        toast('Thêm thất bại: ' + error.message, 'err');
        saveBusy = false;
        if (btnSave) btnSave.disabled = false;
        return;
      }

      toast('Đã thêm khách hàng', 'ok');
    } else {
      const { error } = await SB
        .from(TABLE)
        .update({
          ten_kh,
          dia_chi,
          phuong_xa,
          thanh_pho,
          dien_thoai
        })
        .eq('ma_kh', CURRENT.ma_kh);

      if (error){
        console.error(error);
        toast('Sửa thất bại: ' + error.message, 'err');
        saveBusy = false;
        if (btnSave) btnSave.disabled = false;
        return;
      }

      toast('Đã lưu', 'ok');
    }

    saveBusy = false;
    if (btnSave) btnSave.disabled = false;

    closeModal();

    if (coords) runNearby(coords.lat, coords.lng, getRadiusFromUI(), false);
    else loadData(false);
  }

  async function runNearby(lat, lng, radius, showStatusToast = false){
    const $tbody = $('#tbody');
    $tbody.innerHTML =
      `<tr><td colspan="4" class="muted">Đang lọc theo bán kính...</td></tr>`;

    const R = 6371000;
    const d2r = Math.PI / 180;
    const latR = lat * d2r;
    const delta = (radius / R) * (180 / Math.PI);
    const cosLat = Math.max(1e-6, Math.cos(latR));

    const minLat = lat - delta;
    const maxLat = lat + delta;
    const minLng = lng - delta / cosLat;
    const maxLng = lng + delta / cosLat;

    const { data, error } = await SB
      .from(TABLE)
      .select('ma_kh,ten_kh,dia_chi,phuong_xa,thanh_pho,dien_thoai,lat,lng,ngay_cuoi_cung_checkin', { count:'exact' })
      .not('lat','is',null)
      .not('lng','is',null)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng)
      .limit(1000);

    if (error){
      console.error(error);
      toast('Lỗi truy vấn Supabase','err');
      $('#tbody').innerHTML =
        `<tr><td colspan="4" class="muted">Không có dữ liệu</td></tr>`;
      $('#countInfo').textContent = `0 dòng (lỗi truy vấn)`;
      return;
    }

    const { rows: sourceRows, disabledCount } = getCheckinTodayState(data || []);

    const rows = sourceRows
      .map(r=>({ ...r, rlat:Number(r.lat), rlng:Number(r.lng) }))
      .filter(r=>Number.isFinite(r.rlat) && Number.isFinite(r.rlng));

    const nearby = rows.map(r=>{
      const dLat = (r.rlat - lat) * d2r;
      const dLng = (r.rlng - lng) * d2r;
      const a = Math.sin(dLat/2)**2 +
                Math.cos(latR) * Math.cos(r.rlat*d2r) * Math.sin(dLng/2)**2;
      const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return { ...r, dist: Math.round(dist) };
    }).filter(r=>r.dist <= radius)
      .sort((a,b)=>a.dist - b.dist);

    if (nearby.length === 0){
      $('#tbody').innerHTML =
        `<tr><td colspan="4" class="muted">Không có dữ liệu</td></tr>`;
      $('#countInfo').textContent =
        `0 dòng (lọc ${Math.round(radius)}m)` + (disabledCount ? ` • Disable ${disabledCount} KH đã check-in hôm nay` : '');
      if (showStatusToast) toast(`Không có KH trong ${Math.round(radius)}m`, 'info');
      return;
    }

    renderRows(nearby);

    $('#countInfo').textContent =
      `${nearby.length} dòng (lọc ${Math.round(radius)}m)` + (disabledCount ? ` • Disable ${disabledCount} KH đã check-in hôm nay` : '');

    if (showStatusToast){
      toast(
        `Tìm thấy ${nearby.length} KH` + (disabledCount ? ` • Disable ${disabledCount} KH đã check-in hôm nay` : ''),
        'ok'
      );
    }
  }

  $('#btnAdd')?.addEventListener('click',()=>openModal('add'));
  $('#btnCancel')?.addEventListener('click',closeModal);
  $('#btnSave')?.addEventListener('click',saveForm);

  const btnOpenCheckin = $('#btnOpenCheckin');

  if (btnOpenCheckin){
    btnOpenCheckin.addEventListener('click', ()=>{
      const coords = getLatLngFromURL();
      const url = new URL('app_checkin.html', location.href);

      url.searchParams.set('ma_nv', AUTH_NV.ma_nv);
      url.searchParams.set('ten_nv', AUTH_NV.ten_nv || '');
      url.searchParams.set('radius', String(getRadiusFromUI()));

      if (coords){
        url.searchParams.set('lat', String(coords.lat));
        url.searchParams.set('lng', String(coords.lng));
      }

      location.assign(url.toString());
    });
  }

  $('#radiusSelect')?.addEventListener('change',()=>{
    const coords = getLatLngFromURL();
    const r = getRadiusFromUI();

    if (coords) runNearby(coords.lat, coords.lng, r, true);
    else toast('Thiếu toạ độ lat/lng trong URL để lọc theo bán kính', 'err');
  });

  try{
    SB = await makeClient();

    await loadCheckedToday();
    applyCheckedTodayLock();
    initRadiusFromURLOrDefault();

    const coords = getLatLngFromURL();

    if (coords){
      runNearby(coords.lat, coords.lng, getRadiusFromUI(), false);
    }else{
      loadData(false);
    }
  }catch(e){
    console.error(e);
    $('#tbody').innerHTML =
      `<tr><td colspan="4" class="muted">Lỗi khởi tạo: ${e.message}</td></tr>`;
  }
})();
