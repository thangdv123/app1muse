// Dịch Nói Việt – Trung: ghi âm -> dịch -> đọc, hai chiều.
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
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text, lang) {
  if (!('speechSynthesis' in window)) { alert('Trình duyệt này không hỗ trợ đọc giọng nói. Hãy dùng Chrome.'); return; }
  if (!text || text === '—') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const code = lang.slice(0, 2).toLowerCase();
  const v = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(code));
  if (v) u.voice = v;
  u.rate = 0.9;
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

// ---------- Ghi âm ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function startListen(lang, micBtn, statusEl, onFinal) {
  if (!SR) { statusEl.textContent = 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome trên Android.'; return; }
  const rec = new SR();
  rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1;
  let finalText = '', done = false;
  micBtn.classList.add('listening');
  statusEl.textContent = '🎙️ Đang nghe… nói đi';
  rec.onresult = function(e) {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    onFinal(finalText || interim, !!finalText);
  };
  rec.onerror = function(e) {
    micBtn.classList.remove('listening');
    statusEl.textContent = micErrorText(e.error);
  };
  rec.onend = function() {
    micBtn.classList.remove('listening');
    statusEl.textContent = 'Bấm mic rồi nói';
    if (finalText && !done) { done = true; onFinal(finalText, true); }
  };
  try { rec.start(); } catch (e) { micBtn.classList.remove('listening'); }
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
async function doViToZh() {
  const text = $('textVi').value.trim();
  if (!text) return;
  $('statusVi').textContent = 'Đang dịch…';
  try {
    const zh = await translate(text, 'vi', 'zh-CN');
    $('zhOut').textContent = zh;
    showPinyin($('pinyinOut'), zh);
    if ($('autoSpeak').checked) speak(zh, 'zh-CN');
    addHist({ src: text, dst: zh, dstLang: 'zh-CN' });
    $('statusVi').textContent = 'Xong ✓';
  } catch (e) { $('statusVi').textContent = 'Không dịch được, kiểm tra mạng rồi thử lại.'; }
}
async function doZhToVi() {
  const text = $('textZh').value.trim();
  if (!text) return;
  $('statusZh').textContent = 'Đang dịch…';
  try {
    const vi = await translate(text, 'zh-CN', 'vi');
    $('viOut').textContent = vi;
    if ($('autoSpeak').checked) speak(vi, 'vi-VN');
    addHist({ src: text, dst: vi, dstLang: 'vi-VN' });
    $('statusZh').textContent = 'Xong ✓';
  } catch (e) { $('statusZh').textContent = 'Không dịch được, kiểm tra mạng rồi thử lại.'; }
}
$('micVi').onclick = function() {
  startListen('vi-VN', $('micVi'), $('statusVi'), function(text, final) {
    $('textVi').value = text;
    if (final) doViToZh();
  });
};
$('micZh').onclick = function() {
  startListen('zh-CN', $('micZh'), $('statusZh'), function(text, final) {
    $('textZh').value = text;
    if (final) doZhToVi();
  });
};
$('goVi').onclick = doViToZh;
$('goZh').onclick = doZhToVi;
$('speakVi').onclick = function() { speak($('textVi').value.trim(), 'vi-VN'); };
$('speakZh').onclick = function() { speak($('zhOut').textContent, 'zh-CN'); };
$('speakZh2').onclick = function() { speak($('textZh').value.trim(), 'zh-CN'); };
$('speakVi2').onclick = function() { speak($('viOut').textContent, 'vi-VN'); };
$('textVi').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doViToZh(); } });
$('textZh').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doZhToVi(); } });

// Đổi vị trí 2 khung
$('swapBtn').onclick = function() {
  const panels = $('panels');
  panels.appendChild(panels.firstElementChild);
};

// ---------- Câu mẫu ----------
const PHRASES = [
  { vi: 'Xin chào', zh: '你好', py: 'Nǐ hǎo' },
  { vi: 'Bạn khỏe không?', zh: '你好吗？', py: 'Nǐ hǎo ma?' },
  { vi: 'Bạn ăn cơm chưa?', zh: '你吃饭了吗？', py: 'Nǐ chī fàn le ma?' },
  { vi: 'Hôm nay bạn có rảnh không?', zh: '你今天有空吗？', py: 'Nǐ jīntiān yǒu kòng ma?' },
  { vi: 'Cảm ơn bạn', zh: '谢谢你', py: 'Xièxie nǐ' },
  { vi: 'Tôi không hiểu', zh: '我不明白', py: 'Wǒ bù míngbái' },
  { vi: 'Cái này bao nhiêu tiền?', zh: '这个多少钱？', py: 'Zhège duōshao qián?' },
  { vi: 'Tôi muốn đi ăn', zh: '我想去吃饭', py: 'Wǒ xiǎng qù chī fàn' },
  { vi: 'Tạm biệt', zh: '再见', py: 'Zàijiàn' },
  { vi: 'Chúc ngủ ngon', zh: '晚安', py: 'Wǎn\'ān' }
];
const grid = $('phraseGrid');
PHRASES.forEach(function(p) {
  const b = document.createElement('button');
  b.className = 'phrase';
  b.innerHTML = '<div class="p-zh">' + esc(p.zh) + '</div><div class="p-py">' + esc(p.py) + '</div><div class="p-vi">' + esc(p.vi) + '</div>';
  b.onclick = function() { speak(p.zh, 'zh-CN'); addHist({ src: p.vi, dst: p.zh, dstLang: 'zh-CN' }); };
  grid.appendChild(b);
});

renderHist();
