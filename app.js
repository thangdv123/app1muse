// Dịch Nói Việt – Trung: mic luôn mở, nghe -> dịch -> đọc, hai chiều.
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
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + from + '|' + to;
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
function speak(text, lang, onend) {
  if (!('speechSynthesis' in window)) { alert('Trình duyệt này không hỗ trợ đọc giọng nói. Hãy dùng Chrome.'); if (onend) onend(); return; }
  if (!text || text === '—') { if (onend) onend(); return; }
  speakToken++;
  const myToken = speakToken;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const code = lang.slice(0, 2).toLowerCase();
  const v = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(code));
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

let alwaysOn = true;
let currentSide = null;   // 'vi' | 'zh' | null
let userPaused = false;
let rec = null;
let recActive = false;
let pendingText = '';
let lastSpeechAt = 0;
let silenceTimer = null;
let finalParts = [];
let lastConsumed = '';
let echoGuardUntil = 0;

function setStatus(side, msg) { $(SIDE[side].status).textContent = msg; }
function setMicVisual(side) {
  ['vi', 'zh'].forEach(function(s) { $(SIDE[s].mic).classList.toggle('listening', s === side); });
}

// Mic luôn mở: nghe liên tục, ngừng nói 1,5 giây thì tự dịch + đọc, đọc xong tự mở lại.
function startContinuous(side) {
  if (!SR) { setStatus(side, 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome trên Android.'); return; }
  stopContinuous(true);
  speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const cfg = SIDE[side];
  const r = new SR();
  r.lang = cfg.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  rec = r; currentSide = side; userPaused = false;
  pendingText = ''; lastSpeechAt = 0; finalParts = []; lastConsumed = '';
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
    $(cfg.text).value = pendingText;
    if (pendingText) lastSpeechAt = Date.now();
  };
  r.onerror = function(e) {
    if (e.error === 'aborted' || e.error === 'no-speech') return;
    recActive = false;
    setMicVisual(null);
    setStatus(side, micErrorText(e.error));
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') currentSide = null;
  };
  r.onend = function() {
    recActive = false;
    setMicVisual(null);
    if (alwaysOn && !userPaused && currentSide) {
      const tail = pendingText.trim();
      if (tail) {
        // Chrome tự ngắt mà còn câu chưa dịch: chốt luôn câu đó.
        finishUtterance(currentSide, tail);
      } else {
        setTimeout(function() { if (alwaysOn && !userPaused && currentSide) startContinuous(currentSide); }, 300);
      }
    } else if (currentSide) {
      setStatus(currentSide, 'Bấm mic rồi nói');
    }
  };
  try {
    r.start();
    recActive = true;
    setMicVisual(side);
    setStatus(side, '🎙️ Mic đang mở — cứ nói');
    setStatus(side === 'vi' ? 'zh' : 'vi', 'Bấm mic rồi nói');
    watchSilence();
  } catch (e) { recActive = false; }
}

function stopContinuous(silent) {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
  if (rec) { try { rec.onend = null; rec.onerror = null; rec.stop(); } catch (e) {} rec = null; }
  recActive = false;
  if (!silent) setMicVisual(null);
}

// Theo dõi lúc ngừng nói: im 1,5 giây thì dịch + đọc, rồi mở mic lại.
function watchSilence() {
  if (silenceTimer) return;
  silenceTimer = setInterval(function() {
    if (!recActive || !currentSide) return;
    const text = pendingText.trim();
    if (!text) return;
    if (Date.now() - lastSpeechAt >= 1500) {
      const side = currentSide;
      clearInterval(silenceTimer); silenceTimer = null;
      finishUtterance(side, text);
    }
  }, 300);
}

// Mỗi đoạn chốt chỉ nhận đúng một lần, rút gọn cụm lặp rồi mới dịch.
function finishUtterance(side, text) {
  const clean = collapseRepeats(text);
  if (!clean || clean === lastConsumed) return;
  lastConsumed = clean;
  pendingText = '';
  finalParts = [];
  lastSpeechAt = 0;
  stopContinuous(true);
  doTranslateSide(side, clean).then(function() {
    if (alwaysOn && !userPaused) {
      // Chờ hết tiếng vang loa rồi mới mở mic lại.
      setTimeout(function() {
        if (alwaysOn && !userPaused) {
          echoGuardUntil = Date.now() + 700;
          startContinuous(side);
        }
      }, 900);
    } else setStatus(side, 'Bấm mic rồi nói');
  });
}

// Chế độ bấm để nói 1 lần (khi tắt "Mic luôn mở").
function startListenOnce(lang, micBtn, statusEl, onFinal) {
  if (!SR) { statusEl.textContent = 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome trên Android.'; return; }
  const rec1 = new SR();
  rec1.lang = lang; rec1.interimResults = true; rec1.maxAlternatives = 1;
  let finalText = '', done = false;
  micBtn.classList.add('listening');
  statusEl.textContent = '🎙️ Đang nghe… nói đi';
  rec1.onresult = function(e) {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    onFinal(finalText || interim, !!finalText);
  };
  rec1.onerror = function(e) {
    micBtn.classList.remove('listening');
    statusEl.textContent = micErrorText(e.error);
  };
  rec1.onend = function() {
    micBtn.classList.remove('listening');
    statusEl.textContent = 'Bấm mic rồi nói';
    if (finalText && !done) { done = true; onFinal(finalText, true); }
  };
  try { rec1.start(); } catch (e) { micBtn.classList.remove('listening'); }
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
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 30))); } catch (e) {}
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

// Dịch từ ô gõ chữ (tạm dừng mic trong lúc dịch rồi mở lại).
function manualTranslate(side) {
  const text = $(SIDE[side].text).value.trim();
  if (!text) return;
  const wasListening = (currentSide === side);
  if (wasListening) stopContinuous(true);
  doTranslateSide(side, text).then(function() {
    if (alwaysOn && !userPaused && wasListening) startContinuous(side);
  });
}

// Chạm mic: đang nghe phía này thì tắt tạm; đang nghe phía kia thì đổi phía; đang tắt thì mở lại.
function onMicTap(side) {
  if (alwaysOn) {
    if (currentSide === side) {
      userPaused = true;
      stopContinuous();
      currentSide = null;
      setStatus(side, 'Đã tắt mic tạm thời — bấm lại để mở');
    } else {
      startContinuous(side);
    }
  } else {
    startListenOnce(SIDE[side].lang, $(SIDE[side].mic), $(SIDE[side].status), function(text, final) {
      $(SIDE[side].text).value = text;
      if (final) manualTranslate(side);
    });
  }
}
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

// Công tắc "Mic luôn mở" trên thanh công cụ.
$('alwaysOnMic').onchange = function() {
  alwaysOn = this.checked;
  if (alwaysOn) { userPaused = false; startContinuous(currentSide || 'vi'); }
  else {
    stopContinuous();
    currentSide = null;
    setStatus('vi', 'Bấm mic rồi nói');
    setStatus('zh', 'Bấm mic rồi nói');
  }
};

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

// Mở app là mic tự mở nghe phía tiếng Việt.
setTimeout(function() { if (alwaysOn && window.isSecureContext) startContinuous('vi'); }, 400);
