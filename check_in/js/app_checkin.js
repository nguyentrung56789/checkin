/* ================== CONFIG ================== */
const TARGET_W = 900, TARGET_H = 1600;

/* ===== SHEET so sánh (<=20m) khi bật cam ===== */
const SHEET_URL = new URLSearchParams(location.search).get('sheet')
  || 'https://docs.google.com/spreadsheets/d/.../pub?output=csv'; // TODO: thay link CSV của bạn
const SHEET_TTL_MS = 5 * 60 * 1000;
const NEAR_RADIUS_M = 20;
let SHEET_POINTS = [];
const SESSION_IMG_KEY = 'CHECKIN_IMAGE_PAYLOAD';

/* ===== Local cache helpers ===== */
const lsGet = k => { try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null} };
const lsSet = (k,v) => localStorage.setItem(k, JSON.stringify(v));

function parseCsv(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const headers = lines[0].split(',').map(s=>s.trim().toLowerCase());
  const id = n => headers.indexOf(n);
  const pick = (...c)=>{ for(const x of c){ const i=id(x); if(i>=0) return i; } return -1; };
  const idx = {
    lat:   pick('lat','latitude','vi_do','vido'),
    lng:   pick('lng','lon','longitude','kinh_do','kinhdo'),
    name:  pick('name','ten','tên'),
    ma_kh: pick('ma_kh','makh','ma','mã'),
    ma_hd: pick('ma_hd','mahd')
  };
  const out=[];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(',').map(s=>s.trim());
    const lat = Number(cols[idx.lat]), lng = Number(cols[idx.lng]);
    if(!isFinite(lat)||!isFinite(lng)) continue;
    out.push({
      lat, lng,
      name:  idx.name >=0 ? cols[idx.name]  : '',
      ma_kh: idx.ma_kh>=0 ? cols[idx.ma_kh] : '',
      ma_hd: idx.ma_hd>=0 ? cols[idx.ma_hd] : ''
    });
  }
  return out;
}

async function ensureSheetPoints(){
  if (SHEET_POINTS.length) return SHEET_POINTS;
  const cached = lsGet('SHEET_POINTS_CACHE');
  const ts = lsGet('SHEET_POINTS_TS');
  if (cached && ts && (Date.now()-ts < SHEET_TTL_MS)){
    SHEET_POINTS = cached; return SHEET_POINTS;
  }
  const res = await fetch(SHEET_URL, { cache:'no-store' });
  const ct  = (res.headers.get('content-type')||'').toLowerCase();
  let data=[];
  if (ct.includes('application/json')){
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : []);
    data = arr.map(r=>({
      lat:Number(r.lat), lng:Number(r.lng),
      name:r.name||r.ten||'', ma_kh:r.ma_kh||'', ma_hd:r.ma_hd||r.mahd||''
    })).filter(x=>isFinite(x.lat)&&isFinite(x.lng));
  }else{
    const txt = await res.text();
    data = parseCsv(txt);
  }
  SHEET_POINTS = data;
  lsSet('SHEET_POINTS_CACHE', data);
  lsSet('SHEET_POINTS_TS', Date.now());
  return SHEET_POINTS;
}

function distanceMeters(a,b){
  const toRad=d=>d*Math.PI/180, R=6371000;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const aa=s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2*R*Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
}

function findNearbyInArray(lat,lng,arr,radiusM=NEAR_RADIUS_M){
  let best=null, bestD=Infinity;
  for(const it of arr){
    const d = distanceMeters({lat,lng},{lat:it.lat,lng:it.lng});
    if(d<=radiusM && d<bestD){ best={...it, dist:Math.round(d)}; bestD=d; }
  }
  return best;
}

async function afterCameraStartedCheck20m(){
  try{
    await ensureSheetPoints();
    const g = await getGPSOnce();
    if (g && (g.acc==null || g.acc<=60)){
      const hit = findNearbyInArray(g.lat, g.lng, SHEET_POINTS, NEAR_RADIUS_M);
      if (hit){
        const label = hit.name || hit.ma_kh || hit.ma_hd || 'Vị trí';
        toast(`✅ ${label} đã được check-in (${hit.dist}m)`, 'ok', 3500);
      }
    }
  }catch{}
}

/* ================== DOM & PARAMS ================== */
const $ = id => document.getElementById(id);

const video     = $('video');
const canvas    = $('canvas');
const btnStart  = $('btnStart');
const btnShot   = $('btnShot');
const btnTorch  = $('btnTorch');
const btnSound  = $('btnSound');
const btnZoomIn = $('btnZoomIn');
const btnZoomOut= $('btnZoomOut');
const btnMenu   = $('btnMenu'); // nút Menu mới

const toastEl   = $('toast');
const bar       = $('bar');
const tagInfo   = $('tagInfo');
const stage     = $('stage') || document.querySelector('.stage');

if (video) {
  video.style.objectFit = 'cover';
  video.setAttribute('playsinline','');
  video.muted = true;
}

const qp   = new URLSearchParams(location.search);
const MA_KH = qp.get('ma_kh') || '';
const MA_HD = qp.get('ma_hd') || '';
if (tagInfo) {
  tagInfo.textContent = [MA_KH && `KH:${MA_KH}`, MA_HD && `HD:${MA_HD}`]
    .filter(Boolean).join(' · ');
}

/* ================== AUDIO (shutter) ================== */
let audioCtx = null, compressor = null;
const SHUTTER_GAIN = 0.9;

async function ensureAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressor.knee.setValueAtTime(30, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.1, audioCtx.currentTime);
    compressor.connect(audioCtx.destination);
  }
  if(audioCtx.state === 'suspended') await audioCtx.resume();
}

function noiseBurst(ctx, t0, dur=0.03){
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * 0.6;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(SHUTTER_GAIN, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(4500, t0);
  src.connect(lp); lp.connect(g); g.connect(compressor);
  src.start(t0); src.stop(t0 + dur + 0.01);
}

let soundEnabled = (localStorage.getItem('soundEnabled')??'1') === '1';

function renderSoundBtn(){
  if (!btnSound) return;
  btnSound.classList.toggle('btn-on', soundEnabled);
  btnSound.textContent = soundEnabled ? '🔊' : '🔇';
  btnSound.title = soundEnabled ? 'Đang bật tiếng (bấm để tắt)' : 'Đang tắt tiếng (bấm để bật)';
}
renderSoundBtn();

btnSound && (btnSound.onclick = ()=>{ 
  soundEnabled=!soundEnabled; 
  localStorage.setItem('soundEnabled', soundEnabled?'1':'0'); 
  renderSoundBtn(); 
  toast(soundEnabled?'Đã bật tiếng chụp':'Đã tắt tiếng chụp'); 
});

async function playShutter(){
  if(!soundEnabled) return;
  await ensureAudioCtx();
  const ctx = audioCtx; const now = ctx.currentTime;
  noiseBurst(ctx, now, 0.035);
  const osc1 = ctx.createOscillator(), g1 = ctx.createGain();
  osc1.type='square'; osc1.frequency.setValueAtTime(1400, now);
  g1.gain.setValueAtTime(0, now);
  g1.gain.linearRampToValueAtTime(SHUTTER_GAIN, now + 0.01);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc1.connect(g1); g1.connect(compressor); osc1.start(now); osc1.stop(now + 0.1);
  const t2 = now + 0.06;
  const osc2 = ctx.createOscillator(), g2 = ctx.createGain();
  osc2.type='square'; osc2.frequency.setValueAtTime(950, t2);
  g2.gain.setValueAtTime(0, t2);
  g2.gain.linearRampToValueAtTime(SHUTTER_GAIN*0.7, t2 + 0.012);
  g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.08);
  osc2.connect(g2); g2.connect(compressor); osc2.start(t2); osc2.stop(t2 + 0.09);
  if (navigator.vibrate) navigator.vibrate(30);
}

/* ================== TOAST ================== */
function toast(t,type='info',ms=2400){
  if (!toastEl) return;
  toastEl.textContent=t;
  toastEl.style.opacity='1';
  toastEl.style.transform='translate(-50%,10px)';
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{
    toastEl.style.opacity='0';
    toastEl.style.transform='translate(-50%,-120%)';
  },ms);
}

const CSS_DIGITAL_ZOOM_MAX = 5;

/* ================== CAMERA, ZOOM, TORCH ================== */
let stream=null, videoTrack=null, torchOn=false;
let zoomSupported=false, cssZoomFallback=false;
let zoomMin=1, zoomMax=1, zoomStep=0.1, zoomVal=1;

function stopCam(){
  if(stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch{} }
  stream=null; videoTrack=null;
  if (video) video.srcObject=null;
}

// Dùng logic giống checkin.js FINAL + ZOOM
async function startCam(){
  try{
    // Tắt stream cũ
    stopCam();
    stage && stage.classList.remove('ready');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Trình duyệt không hỗ trợ camera');
    }

    const base = {
      video: {
        width:  { ideal: 1080 },
        height: { ideal: 1920 },
        facingMode: { ideal: 'environment' }
      },
      audio: false
    };

    try{
      stream = await navigator.mediaDevices.getUserMedia(base);
    }catch(e){
      if (e.name === 'NotAllowedError') {
        throw new Error('Bạn đã chặn quyền camera. Vào Cài đặt trình duyệt để bật lại.');
      }
      if (e.name === 'NotFoundError') {
        throw new Error('Không tìm thấy thiết bị camera.');
      }
      if (String(e.message || '').includes('Device in use')) {
        toast('Camera đang bận — thử lại...', 'info', 2000);
        await new Promise(r => setTimeout(r, 1000));
        stream = await navigator.mediaDevices.getUserMedia(base);
      } else {
        throw e;
      }
    }

    if (video) {
      video.srcObject = stream;
      video.setAttribute('playsinline','');
      video.muted = true;

      // Đợi metadata
      await new Promise(r => { video.onloadedmetadata = r; });

      // BẮT BUỘC phải play() cho mobile
      try {
        await video.play();
      } catch (err) {
        console.warn('Không play được video:', err);
      }
    }

    videoTrack = stream.getVideoTracks()[0] || null;

    stage && stage.classList.add('ready');

    if (btnShot) btnShot.disabled = false;
    await initZoom();
    // 👇 luôn dùng mức zoom nhỏ nhất
    await setZoom(zoomMin);
    await tryApplyTorch(false);

    toast('Đã bật camera','ok');

    // ✅ Chạy kiểm tra 20m ở NỀN, không chặn UI / không làm load chậm
    setTimeout(() => {
      afterCameraStartedCheck20m().catch(()=>{});
    }, 200);

  }catch(e){

    console.error(e);
    if (btnShot) btnShot.disabled = true;
    stage && stage.classList.remove('ready');
    toast('Lỗi camera: ' + (e.message || e), 'err', 4200);
  }
}

function renderCssZoom(){
  if (!video) return;
  video.style.transformOrigin = 'center center';
  video.style.transform = `scale(${zoomVal})`;
}

async function initZoom(){
  zoomSupported = false;
  cssZoomFallback = false;
  zoomMin = 1;
  zoomMax = 1;
  zoomStep = 0.1;
  zoomVal = 1;

  try{
    const caps = videoTrack?.getCapabilities?.() || {};
    const hasZoom = caps && typeof caps.zoom === 'object';

    if (hasZoom && typeof caps.zoom.min === 'number'){
      zoomSupported = true;
      zoomMin  = caps.zoom.min;
      zoomMax  = caps.zoom.max || caps.zoom.min;
      zoomStep = caps.zoom.step || 0.1;
      zoomVal  = zoomMin;
      await videoTrack.applyConstraints({ advanced: [{ zoom: zoomVal }] });
    } else {
      cssZoomFallback = true;
      zoomMin  = 1;
      zoomMax  = CSS_DIGITAL_ZOOM_MAX;
      zoomStep = 0.2;
      zoomVal  = 1;
      renderCssZoom();
    }
  } catch {
    cssZoomFallback = true;
    zoomMin  = 1;
    zoomMax  = CSS_DIGITAL_ZOOM_MAX;
    zoomStep = 0.2;
    zoomVal  = 1;
    renderCssZoom();
  }

  if (btnZoomIn)  btnZoomIn.disabled  = (zoomVal >= zoomMax);
  if (btnZoomOut) btnZoomOut.disabled = (zoomVal <= zoomMin);
}

async function setZoom(next){
  next = Number(next) || 1;
  next = Math.max(zoomMin, Math.min(zoomMax, next));
  if (Math.abs(next - zoomVal) < 1e-3) return;
  zoomVal = next;

  try{
    if (zoomSupported){
      await videoTrack.applyConstraints({ advanced: [{ zoom: zoomVal }] });
    } else if (cssZoomFallback){
      renderCssZoom();
    }
  } catch (e){
    cssZoomFallback = true;
    zoomSupported = false;
    renderCssZoom();
  }

  if (btnZoomOut) btnZoomOut.disabled = zoomVal <= (zoomMin + 1e-6);
  if (btnZoomIn)  btnZoomIn.disabled  = zoomVal >= (zoomMax - 1e-6);
}

btnZoomIn  && (btnZoomIn.onclick  = ()=> setZoom((zoomVal + zoomStep).toFixed(2)));
btnZoomOut && (btnZoomOut.onclick = ()=> setZoom((zoomVal - zoomStep).toFixed(2)));

async function tryApplyTorch(turnOn){
  try{
    if(!videoTrack) return false;
    const capabilities = videoTrack.getCapabilities?.() || {};
    if(!('torch' in capabilities)) { if (btnTorch) btnTorch.disabled=true; return false; }
    await videoTrack.applyConstraints({ advanced: [{ torch: !!turnOn }] });
    torchOn = !!turnOn;
    btnTorch && btnTorch.classList.toggle('btn-on', torchOn);
    return true;
  }catch{
    if (btnTorch) btnTorch.disabled=true;
    return false;
  }
}

btnTorch && (btnTorch.onclick = async ()=>{
  const ok = await tryApplyTorch(!torchOn);
  if(!ok) toast('Thiết bị không hỗ trợ đèn', 'err');
});

/* ================== CANVAS & GPS ================== */
function drawToCanvas(){
  if (!video || !canvas) return;
  const fw = video.videoWidth, fh = video.videoHeight;
  if(!fw || !fh) return;
  const desired = TARGET_W / TARGET_H;
  const ar = fw / fh;
  let sx=0, sy=0, sw=fw, sh=fh;
  if (ar > desired){ sw = fh * desired; sx = (fw - sw) / 2; }
  else { sh = fw / desired; sy = (fh - sh) / 2; }
  if (cssZoomFallback && zoomVal > 1){
    const cx = sx + sw/2, cy = sy + sh/2, z = zoomVal;
    const newSw = sw / z, newSh = sh / z;
    sx = cx - newSw/2; sy = cy - newSh/2; sw = newSw; sh = newSh;
  }
  canvas.width = TARGET_W; canvas.height = TARGET_H;
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
}

function getGPSOnce(){ 
  return new Promise(resolve=>{
    if(!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}),
      _=>resolve(null),
      { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
    );
  });
}

// ================== REQUIRE GPS BEFORE CAMERA ==================
async function ensureGeoPermission(){
  // trả về true nếu geolocation đã sẵn sàng để xin GPS
  try{
    if (navigator.permissions?.query){
      const p = await navigator.permissions.query({ name:'geolocation' });
      if (p.state === 'denied'){
        toast('⚠️ Bạn đang tắt quyền Vị trí. Hãy bật lại trong Site Settings.', 'err', 4200);
        alert('Bạn đang tắt quyền Vị trí cho trang này.\nHãy vào Cài đặt trình duyệt (Site settings) → Location → Allow.');
        return false;
      }
      // 'prompt' hoặc 'granted' đều có thể tiếp tục xin GPS
    }
  }catch(_){}
  return true;
}

async function requireGPSBeforeCamera(){
  const okPerm = await ensureGeoPermission();
  if (!okPerm) return null;

  toast('📍 Đang lấy vị trí GPS...', 'info', 2000);

  // xin GPS thật sự (để trình duyệt hiện prompt nếu cần)
  const gps = await getGPSOnce();

  // Chặn nếu chưa có / lat = 0 / lng = 0
  const lat = Number(gps?.lat || 0);
  const lng = Number(gps?.lng || 0);

  if (!lat || !lng){
    toast('⚠️ Chưa có vị trí. Hãy bật GPS/Location rồi thử lại.', 'err', 3500);
    alert('Chưa có vị trí (GPS).\n- Bật Location/GPS\n- Cho phép quyền vị trí cho trang\n- Ra chỗ thoáng rồi bấm lại');
    return null;
  }

  // nếu muốn “chặt” hơn: yêu cầu độ chính xác <= 80m
  const acc = Number(gps?.acc ?? 9999);
  if (acc > 120){
    toast(`⚠️ GPS yếu (±${Math.round(acc)}m). Di chuyển ra chỗ thoáng rồi thử lại.`, 'err', 3500);
    // vẫn trả về gps để bạn quyết định có cho mở cam hay không:
    return null; // nếu bạn muốn GPS yếu cũng CHẶN mở cam
  }

  return { lat, lng, acc };
}

/* ================== EVENTS ================== */
btnStart && (btnStart.onclick = async ()=>{
  const gps = await requireGPSBeforeCamera();
  if (!gps) return;              // CHƯA CÓ GPS → THOÁT
  await startCam();              // CÓ GPS → MỚI MỞ CAM
});

let shooting = false;
btnShot && (btnShot.onclick = async ()=>{
  if(!stream || shooting){ toast('Đang xử lý...', 'info'); return; }
  shooting = true; btnShot.disabled = true;

  try{
    await ensureAudioCtx();
    await playShutter();
    drawToCanvas();

    const mime = 'image/jpeg';
    const dataUrl = canvas.toDataURL(mime, 0.85);
    const gps = await getGPSOnce();

    const lat = gps?.lat ?? '';
    const lng = gps?.lng ?? '';
    const payload = {
      image_mime: mime,
      image_b64: (dataUrl.split(',')[1] || ''),
      ma_kh: MA_KH || '',
      ma_hd: MA_HD || ''
    };

    sessionStorage.setItem(SESSION_IMG_KEY, JSON.stringify(payload));

    const targetUrl = new URL('/checkin_khach_hang.html', location.origin);
    if (lat !== '') targetUrl.searchParams.set('lat', String(lat));
    if (lng !== '') targetUrl.searchParams.set('lng', String(lng));
    if (lat !== '') targetUrl.searchParams.set('lag', String(lat));
    if (MA_KH)      targetUrl.searchParams.set('ma_kh', MA_KH);
    if (MA_HD)      targetUrl.searchParams.set('ma_hd', MA_HD);
    targetUrl.searchParams.set('img', 'session');

    location.assign(targetUrl.toString());
  } catch (err) {
    console.error(err);
    toast('Lỗi khi chuẩn bị dữ liệu: ' + (err.message || err), 'err', 4000);
  } finally {
    setTimeout(()=>{ shooting = false; btnShot.disabled = !stream; }, 800);
  }
});

/* Nút Menu → về main.html */
btnMenu && (btnMenu.onclick = ()=>{ location.assign('main.html'); });

/* ================== AUTO BOOT ================== */

// helper: đảm bảo stage + UI hiện ra (kể cả khi chưa bật cam)
function showStage(){
  if (stage && !stage.classList.contains('ready')) {
    stage.classList.add('ready');
  }
}

/** 
 * Chỉ auto bật cam nếu đã được cấp quyền từ lần trước (state = 'granted').
 * Nếu chưa được cấp / bị hỏi lại → không auto, chỉ hiện UI + toast 
 * để người dùng tự bấm nút "Bật camera".
 */
(async () => {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const camPerm = await navigator.permissions.query({ name: 'camera' });
      let geoPerm = null;
      try {
        geoPerm = await navigator.permissions.query({ name: 'geolocation' });
      } catch (_) {}

        if (camPerm.state === 'granted') {
          const gps = await requireGPSBeforeCamera();
          if (gps) {
            await startCam();
          } else {
            showStage();
            if (btnShot) btnShot.disabled = true;
            toast('Hãy bật GPS trước, rồi bấm "Bật camera".', 'info', 3000);
          }
        } else {
          showStage();
          if (btnShot) btnShot.disabled = true;
          toast('Bấm nút "Bật camera" để mở cam.', 'info', 3000);
        }

      // GPS: chỉ pre-warm nếu đã granted
      if (geoPerm && geoPerm.state === 'granted') {
        navigator.geolocation.getCurrentPosition(()=>{},()=>{});
      }

      // Nếu trạng thái quyền camera thay đổi trong lúc đang mở trang
      camPerm.onchange = () => {
        if (camPerm.state === 'granted') {
          toast('Đã cấp quyền camera, bấm "Bật camera" để dùng.', 'ok', 2500);
        }
      };
    } else {
      // Không hỗ trợ Permissions API → vẫn phải hiện UI cho user bấm
      showStage();
      if (btnShot) btnShot.disabled = true;
      toast('Bấm nút "Bật camera" để mở cam.', 'info', 3000);
    }
  } catch (e) {
    console.warn('Auto boot error', e);
    showStage();
  }
})();

/* Khi tab ẩn/hiện lại */
document.addEventListener('visibilitychange', () => { 
  if (document.hidden) {
    // Ẩn tab → tắt camera cho nhẹ máy
    stopCam();
  } else {
    // Quay lại: không tự bật cam, chỉ hiện UI + nhắc
    showStage();
    if (!stream) {
      if (btnShot) btnShot.disabled = true;
      toast('Bấm nút "Bật camera" để mở lại cam.', 'info', 2500);
    }
  }
});
