// Dịch Nói Việt – Trung: chạm mic để mở/tắt, nghe -> dịch -> đọc, hai chiều.
const $ = id => document.getElementById(id);

// ---------- Dịch (Google trước, MyMemory dự phòng) ----------
async function translateGoogle(text, from, to) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + from + '&tl=' + to + '&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('google ' + res.status);
  const data = await res.json();
  const out = (data[0] || []).map(s => s[0]).join('');
  if (!out) throw new Error('google empty');
  return out;
}
async function translateMyMemory(text, from, to) {
  const f = from === 'vi' ? 'vi-VN' : from;
  const t = to === 'vi' ? 'vi-VN' : to;
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + f + '|' + t;
  const res = await fetch(url);
  if (!res.ok) throw new Error('mymemory ' + res.status);
  const data = await res.json();
  const out = data.responseData && data.responseData.translatedText;
  if (!out) throw new Error('mymemory empty');
  return out;
}
async function translate(text, from, to) {
  try { return await translateGoogle(text, from, to); }
  catch (e) { return await translateMyMemory(text, from, to); }
}

// ---------- Đọc giọng nói ----------
let voices = [];
let speakToken = 0;
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
// Chọn giọng đọc: ưu tiên mã chuẩn zh-CN, dự phòng cmn-Hans-CN rồi zh.
function pickVoice(lang) {
  const prefs = lang.toLowerCase().indexOf('zh') === 0
    ? ['zh-cn', 'cmn-hans-cn', 'zh']
    : [lang.slice(0, 2).toLowerCase()];
  for (let k = 0; k < prefs.length; k++) {
    const v = voices.find(function(v) { return v.lang && v.lang.toLowerCase().indexOf(prefs[k]) === 0; });
    if (v) return v;
  }
  return null;
}
function speak(text, lang, onend) {
  if (!('speechSynthesis' in window)) { alert('Trình duyệt này không hỗ trợ đọc giọng nói. Hãy dùng Chrome.'); if (onend) onend(); return; }
  if (!text || text === '—') { if (onend) onend(); return; }
  speakToken++;
  const myToken = speakToken;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = 0.9;
  if (onend) {
    u.onend = function() { if (myToken === speakToken) onend(); };
    u.onerror = function() { if (myToken === speakToken) onend(); };
  }
  speechSynthesis.speak(u);
}

// Thông báo lỗi mic bằng tiếng Việt, nói rõ cách sửa.
function micErrorText(code) {
  if (code === 'not-allowed') return 'Micro đang bị chặn. Bấm biểu tượng ổ khóa trên thanh địa chỉ → Micro → Cho phép, rồi tải lại trang. Nhớ mở bằng Chrome, đừng mở trong app khác.';
  if (code === 'service-not-allowed') return 'Chrome chưa cho dùng ghi âm. Mở link bằng Chrome (bấm ⋮ → Mở trong Chrome), kiểm tra mạng rồi thử lại.';
  if (code === 'audio-capture') return 'Không tìm thấy micro. Kiểm tra micro của máy rồi thử lại.';
  if (code === 'network') return 'Mất mạng khi gửi giọng nói đi dịch. Kiểm tra mạng rồi thử lại.';
  if (code === 'no-speech') return 'Chưa nghe thấy gì, nói to hơn rồi bấm mic thử lại.';
  if (code === 'aborted') return 'Đã dừng nghe. Bấm mic để nói lại.';
  if (code === 'language-not-supported') return 'Máy chưa hỗ trợ nhận giọng ngôn ngữ này. Thử cập nhật Chrome hoặc cài thêm gói giọng nói cho máy rồi thử lại.';
  return 'Lỗi mic: ' + code + ' — thử tải lại trang, hoặc gõ chữ thay cho nói.';
}

// ---------- Chống lặp văn bản ----------
 // Rút gọn câu bị lặp nguyên văn ("xin chào bạn xin chào bạn" -> "xin chào bạn").
function collapseRepeats(text) {
  let words = text.trim().split(/\s+/);
  if (words.length < 2) return text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (let unit = 1; unit <= Math.floor(words.length / 2); unit++) {
      if (words.length % unit !== 0) continue;
      const base = words.slice(0, unit).join(' ');
      let ok = true;
      for (let i = unit; i < words.length; i += unit) {
        if (words.slice(i, i + unit).join(' ') !== base) { ok = false; break; }
      }
      if (ok) { words = words.slice(0, unit); changed = true; break; }
    }
  }
  return words.join(' ');
}

// ---------- Ghi âm ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// Cấu hình 2 phía
const SIDE = {
  vi: { lang: 'vi-VN', from: 'vi', to: 'zh-CN', mic: 'micVi', status: 'statusVi', text: 'textVi', out: 'zhOut', outLang: 'zh-CN', pinyin: 'pinyinOut' },
  zh: { lang: 'zh-CN', from: 'zh-CN', to: 'vi', mic: 'micZh', status: 'statusZh', text: 'textZh', out: 'viOut', outLang: 'vi-VN', pinyin: null }
};

// Chuỗi cấu hình nhận giọng dự phòng: thử lần lượt, phiên nào không trả về chữ thì chuyển sang cấu hình tiếp theo.
const ATTEMPTS = {
  vi: [
    { lang: 'vi-VN', cont: false },
    { lang: 'vi', cont: false },
    { lang: 'vi-VN', cont: true }
  ],
  zh: [
    { lang: 'zh-CN', cont: false },
    { lang: 'cmn-Hans-CN', cont: false },
    { lang: 'zh', cont: false },
    { lang: 'zh-CN', cont: true },
    { lang: 'cmn-Hans-CN', cont: true }
  ]
};
const attemptIdx = { vi: 0, zh: 0 };

let currentSide = null;   // 'vi' | 'zh' | null — phía nào đang mở mic
let rec = null;
let pendingText = '';
let finalParts = [];
let lastConsumed = '';
let echoGuardUntil = 0;
let sessionGotResult = false;
let silentSessions = 0;
let startTimer = null;
let watchTimer = null;

function setStatus(side, msg) { $(SIDE[side].status).textContent = msg; }
// Dòng chẩn đoán dưới mic: mã giọng đang dùng, số ký tự đã nghe, lỗi gần nhất.
const diagState = {
  vi: { lang: 'vi-VN', heard: 0, err: '—' },
  zh: { lang: 'zh-CN', heard: 0, err: '—' }
};
function updateDiag(side) {
  const d = diagState[side];
  const el = $(side === 'vi' ? 'diagVi' : 'diagZh');
  if (el) el.textContent = 'Mã giọng đang dùng: ' + d.lang + ' • Đã nghe được: ' + d.heard + ' ký tự • Lỗi gần nhất: ' + d.err;
}
function setMicVisual(side) {
  ['vi', 'zh'].forEach(function(s) {
    $(SIDE[s].mic).classList.toggle('listening', s === side);
    const tag = $(s === 'vi' ? 'micTagVi' : 'micTagZh');
    if (tag) tag.textContent = (s === side) ? 'Đang mở mic' : 'Đã tắt';
    const wave = $(s === 'vi' ? 'waveVi' : 'waveZh');
    if (wave) wave.classList.toggle('on', s === side);
  });
}

function clearWatch() { if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; } }
// Dừng bộ nhận giọng đang chạy, giữ nguyên trạng thái mở/tắt.
function stopRec() {
  clearWatch();
  if (rec) { try { rec.onend = null; rec.onerror = null; rec.onresult = null; rec.stop(); } catch (e) {} rec = null; }
}
// Tắt mic hẳn.
function stopMic() {
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  stopRec();
  currentSide = null;
  setMicVisual(null);
}

// Chạm mic: đang mở phía này thì tắt; đang mở phía kia thì tắt hẳn phía kia rồi mở phía này.
function onMicTap(side) {
  if (currentSide === side) {
    const tail = pendingText.trim();
    stopMic();
    if (tail) finishUtterance(side, tail);
    else setStatus(side, 'Bấm mic rồi nói');
  } else {
    const prev = currentSide;
    stopMic();
    if (prev) setStatus(prev, 'Bấm mic rồi nói');
    // Chờ nửa giây cho mic cũ nhả hẳn ra rồi mới mở mic mới, tránh xung đột.
    if (prev) startTimer = setTimeout(function() { startMic(side); }, 500);
    else startMic(side);
  }
}

// Mở mic phía này: nghe theo từng phiên ngắn nối lại cho tới khi chạm để tắt.
function startMic(side) {
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  if (!SR) { setStatus(side, 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome trên Android.'); return; }
  currentSide = side;
  pendingText = ''; finalParts = []; lastConsumed = ''; sessionGotResult = false; silentSessions = 0;
  attemptIdx[side] = 0;
  startSession(side);
}

function startSession(side) {
  if (currentSide !== side) return;
  stopRec();
  sessionGotResult = false;
  speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const cfg = SIDE[side];
  const list = ATTEMPTS[side];
  const att = list[attemptIdx[side]];
  const r = new SR();
  r.lang = att.lang; r.continuous = att.cont; r.interimResults = true; r.maxAlternatives = 1;
  rec = r;
  diagState[side].lang = att.lang + (att.cont ? ' (liên tục)' : ''); diagState[side].err = '—'; updateDiag(side);
  // Phiên liên tục mà 10 giây không có chữ nào thì dừng để thử cấu hình khác.
  if (att.cont) {
    watchTimer = setTimeout(function() {
      if (rec === r && !sessionGotResult && currentSide === side) { try { r.stop(); } catch (e) {} }
    }, 10000);
  }
  r.onresult = function(e) {
    // Vừa đọc xong, loa còn vang: bỏ qua tiếng vang thu lại trong lúc này.
    if (Date.now() < echoGuardUntil) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        // Gộp bản sao dài dần: câu chốt mới chứa trọn câu chốt cũ thì chỉ giữ câu mới.
        for (let j = 0; j < i; j++) {
          if (finalParts[j] && t.indexOf(finalParts[j].trim()) !== -1) finalParts[j] = '';
        }
        finalParts[i] = t;
      } else interim += t;
    }
    const next = (finalParts.join('') + interim).trim();
    // Chỉ xử lý khi văn bản thật sự thay đổi.
    if (next === pendingText) return;
    pendingText = next;
    sessionGotResult = true;
    silentSessions = 0;
    clearWatch();
    $(cfg.text).value = pendingText;
    diagState[side].heard = pendingText.length; updateDiag(side);
  };
  r.onerror = function(e) {
    if (e.error === 'aborted') return;
    if (e.error === 'no-speech') return; // để onend xử lý như phiên im lặng
    if (e.error === 'language-not-supported') {
      r.onend = null; clearWatch();
      diagState[side].err = e.error; updateDiag(side);
      advanceAttempt(side, 'Mã giọng ' + att.lang + ' không được hỗ trợ, đang thử mã khác…');
      return;
    }
    // Lỗi khác: báo rõ rồi tắt mic, để bạn bấm lại.
    clearWatch();
    rec = null;
    currentSide = null;
    setMicVisual(null);
    setStatus(side, micErrorText(e.error));
    diagState[side].err = e.error; updateDiag(side);
  };
  r.onend = function() {
    clearWatch();
    rec = null;
    if (currentSide !== side) return; // đã tắt
    const tail = pendingText.trim();
    if (tail) {
      silentSessions = 0;
      finishUtterance(side, tail);
    } else {
      // Phiên im lặng: không nghe được chữ nào -> thử cấu hình tiếp theo.
      silentSessions++;
      if (silentSessions >= list.length) {
        // Đã thử hết các cấu hình mà vẫn không có chữ nào.
        currentSide = null;
        setMicVisual(null);
        setStatus(side, side === 'zh'
          ? 'Không nghe được tiếng Trung trên máy này. Kiểm tra cài đặt giọng nói của máy, hoặc gõ chữ thay cho nói.'
          : 'Không nghe được gì. Thử nói to hơn, hoặc gõ chữ thay cho nói.');
        diagState[side].err = 'không có kết quả'; updateDiag(side);
      } else {
        advanceAttempt(side, 'Không nghe được chữ nào, đang thử mã giọng khác…');
      }
    }
  };
  try {
    r.start();
    setMicVisual(side);
    setStatus(side, 'Mic đang mở — cứ nói, chữ sẽ hiện trong ô bên dưới, nói xong app tự dịch.');
  } catch (err) {
    // start() lỗi (mic cũ chưa nhả hẳn): thử lại sau nửa giây.
    startTimer = setTimeout(function() { if (currentSide === side) startSession(side); }, 500);
  }
}

// Thử cấu hình nhận giọng tiếp theo trong chuỗi dự phòng.
function advanceAttempt(side, msg) {
  const list = ATTEMPTS[side];
  attemptIdx[side] = (attemptIdx[side] + 1) % list.length;
  setStatus(side, msg);
  startTimer = setTimeout(function() { if (currentSide === side) startSession(side); }, 400);
}

// Mỗi đoạn chốt chỉ nhận đúng một lần, rút gọn cụm lặp rồi mới dịch.
function finishUtterance(side, text) {
  const clean = collapseRepeats(text);
  if (!clean || clean === lastConsumed) return;
  lastConsumed = clean;
  pendingText = '';
  finalParts = [];
  stopRec();
  doTranslateSide(side, clean).then(function() {
    if (currentSide === side) {
      // Chờ hết tiếng vang loa rồi mới nghe tiếp.
      setTimeout(function() {
        if (currentSide === side) {
          echoGuardUntil = Date.now() + 700;
          startSession(side);
        }
      }, 900);
    } else setStatus(side, 'Bấm mic rồi nói');
  });
}

// ---------- Pinyin (tải khi cần, lỗi thì thôi) ----------
let pinyinReady = null;
function loadPinyin() {
  if (pinyinReady) return pinyinReady;
  pinyinReady = new Promise(function(resolve) {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/pinyin-pro@3.27.0/dist/index.js';
    s.onload = function() { resolve(!!(window.pinyinPro && window.pinyinPro.pinyin)); };
    s.onerror = function() { resolve(false); };
    document.head.appendChild(s);
  });
  return pinyinReady;
}
async function showPinyin(el, zhText) {
  const ok = await loadPinyin();
  if (!ok) { el.textContent = ''; return; }
  try { el.textContent = window.pinyinPro.pinyin(zhText, { toneType: 'symbol', type: 'array' }).join(' '); }
  catch (e) { el.textContent = ''; }
}

// ---------- Lịch sử ----------
const HIST_KEY = 'vtzh_history';
function getHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; } }
function esc(s) { return String(s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function addHist(item) {
  const h = getHist(); h.unshift(item);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50))); } catch (e) {}
  renderHist();
}
function renderHist() {
  const list = $('histList');
  const h = getHist();
  list.innerHTML = '';
  if (!h.length) { list.innerHTML = '<li class="empty">Chưa có đoạn hội thoại nào.</li>'; return; }
  h.forEach(function(it) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="h-src">' + esc(it.src) + '</div><div class="h-dst">' + esc(it.dst) + '</div>';
    li.onclick = function() { speak(it.dst, it.dstLang); };
    list.appendChild(li);
  });
}
$('clearHist').onclick = function() { try { localStorage.removeItem(HIST_KEY); } catch (e) {} renderHist(); };

// ---------- Dịch 2 chiều ----------
function doTranslateSide(side, text) {
  const cfg = SIDE[side];
  const clean = collapseRepeats(text);
  if (!clean) return Promise.resolve();
  setStatus(side, 'Đang dịch…');
  return translate(clean, cfg.from, cfg.to).then(function(out) {
    $(cfg.out).textContent = out;
    if (cfg.pinyin) showPinyin($(cfg.pinyin), out);
    addHist({ src: clean, dst: out, dstLang: cfg.outLang });
    setStatus(side, 'Xong ✓');
    return new Promise(function(resolve) {
      if ($('autoSpeak').checked) speak(out, cfg.outLang, resolve);
      else resolve();
    });
  }).catch(function() {
    setStatus(side, 'Không dịch được, kiểm tra mạng rồi thử lại.');
  });
}

// Dịch từ ô gõ chữ (tạm dừng mic trong lúc dịch rồi mở lại nếu mic đang mở).
function manualTranslate(side) {
  const text = $(SIDE[side].text).value.trim();
  if (!text) return;
  const wasOn = (currentSide === side);
  if (wasOn) stopMic();
  doTranslateSide(side, text).then(function() {
    if (wasOn) startMic(side);
  });
}

// Chạm mic để mở/tắt.
$('micVi').onclick = function() { onMicTap('vi'); };
$('micZh').onclick = function() { onMicTap('zh'); };
$('goVi').onclick = function() { manualTranslate('vi'); };
$('goZh').onclick = function() { manualTranslate('zh'); };
$('speakVi').onclick = function() { speak($('textVi').value.trim(), 'vi-VN'); };
$('speakZh').onclick = function() { speak($('zhOut').textContent, 'zh-CN'); };
$('speakZh2').onclick = function() { speak($('textZh').value.trim(), 'zh-CN'); };
$('speakVi2').onclick = function() { speak($('viOut').textContent, 'vi-VN'); };
$('textVi').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manualTranslate('vi'); } });
$('textZh').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manualTranslate('zh'); } });

// Đổi vị trí 2 khung
$('swapBtn').onclick = function() {
  const panels = $('panels');
  panels.appendChild(panels.firstElementChild);
};

// Cảnh báo khi mở file tải về (không phải link https): micro không chạy được.
if (!window.isSecureContext) {
  const w = $('insecureWarn');
  if (w) w.hidden = false;
  $('statusVi').textContent = 'Đang mở file tải về nên micro không chạy. Mở bằng link https trong Chrome.';
  $('statusZh').textContent = 'Đang mở file tải về nên micro không chạy. Mở bằng link https trong Chrome.';
}

renderHist();
