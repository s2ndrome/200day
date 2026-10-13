// 3번 인스타 '메시지' → 방문자와 1:1 실시간 DM (Firebase 익명 로그인 + Firestore)
import { firebaseConfig } from './firebase-config.js?v=10131351';

const V = '10.12.2';
// 새 DM 알림: 휴대폰 ntfy 앱에서 이 채널을 구독하면 돼요. 채널 이름이 공개되니 메시지 내용은 보내지 않아요.
const NTFY_TOPIC = 'whats-s-dm-1cdlzfdl6913ix';
// 30초 동안 내가 답을 안 하면 신드롬 말투 AI가 대신 답장해요 (dm/worker.js 를 Cloudflare에 올린 주소)
const AI_URL = 'https://syndrome-chat.jenojeno0423.workers.dev';
const AI_DELAY = 30000;
const $ = (id) => document.getElementById(id);
const dm = $('dm'), body = $('dmBody'), list = $('dmList'), form = $('dmForm'), ta = $('dmText'), btn = $('dmSend'),
  nm = $('dmName'), typing = $('dmTyping'), state = $('dmState'), online = $('dmOnline');

let api = null, ready = null, tid = null, thread = null, lastSeenEl = null, typingTimer = null, lastTypingSent = 0;
let history = [], aiTimer = null, aiBusy = false;

// 기기 정보 (받은 DM함에서만 보여요. IP·위치는 저장하지 않아요)
function device() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '기타';
  const br = /KAKAOTALK/i.test(ua) ? '카카오톡' : /Instagram/.test(ua) ? '인스타그램 앱' : /NAVER/.test(ua) ? '네이버 앱' : /Whale/.test(ua) ? '웨일'
    : /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '기타';
  return os + ' · ' + br;
}

function show(on) {
  dm.hidden = !on;
  document.body.classList.toggle('v-lock', on);
  if (on) { start(); body.scrollTop = body.scrollHeight; setTimeout(() => ta.focus(), 50); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-dm]')) show(true);
  else if (e.target.closest('[data-dm-close]')) show(false);
});

function note(text) { state.textContent = text || ''; state.hidden = !text; }

// 처음 열 때만 Firebase를 불러와요
function start() {
  if (ready) return ready;
  if (!firebaseConfig) { note('DM 준비 중이에요. 곧 열려요!'); form.querySelector('textarea').disabled = true; return (ready = Promise.resolve()); }
  return (ready = (async () => {
    note('연결 중...');
    const [app, auth, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
    ]);
    const a = app.initializeApp(firebaseConfig);
    const au = auth.getAuth(a), db = fs.getFirestore(a);
    const cred = au.currentUser ? { user: au.currentUser } : await new Promise((res, rej) => {
      const off = auth.onAuthStateChanged(au, (u) => { off(); u ? res({ user: u }) : auth.signInAnonymously(au).then(res, rej); });
    });
    tid = cred.user.uid;
    api = { fs, db, ref: fs.doc(db, 'threads', tid), msgs: fs.collection(db, 'threads', tid, 'messages') };
    note('');
    listen();
  })().catch((err) => { console.error(err); note('연결에 실패했어요. 잠시 후 다시 열어주세요.'); ready = null; }));
}

function bubble(m) {
  const d = document.createElement('div');
  d.className = 'bub ' + (m.from === 'v' ? 'me' : 'you');
  d.textContent = m.text;
  if (m.from === 'a' || m.from === 'ai') {
    const row = document.createElement('div'); row.className = 'bub-row';
    const av = document.createElement('img'); av.className = 'av'; av.alt = ''; av.src = dm.dataset.av;
    row.append(av, d); return row;
  }
  return d;
}

function listen() {
  const { fs, ref, msgs } = api;
  fs.onSnapshot(fs.query(msgs, fs.orderBy('at', 'asc')), (snap) => {
    list.textContent = '';
    let lastMine = null;
    history = [];
    snap.forEach((doc) => { const m = doc.data(); history.push({ from: m.from, text: m.text, at: m.at ? m.at.toMillis() : Date.now() }); const el = bubble(m); list.appendChild(el); if (m.from === 'v') lastMine = { el, at: m.at }; else lastMine = null; });
    scheduleAi();
    lastSeenEl = null;
    if (lastMine) { lastSeenEl = document.createElement('div'); lastSeenEl.className = 'bub-st'; lastMine.el.after(lastSeenEl); lastSeenEl.dataset.at = lastMine.at ? lastMine.at.toMillis() : Date.now(); }
    paintSeen(); body.scrollTop = body.scrollHeight;
  });
  fs.onSnapshot(ref, (d) => { thread = d.exists() ? d.data() : null; paintSeen(); paintTyping(); });
  try { nm.value = localStorage.getItem('whats-s-dm-name') || ''; } catch (e) {}
}

function paintSeen() {
  if (!lastSeenEl) return;
  const read = thread && thread.adminReadAt && thread.adminReadAt.toMillis() >= Number(lastSeenEl.dataset.at);
  lastSeenEl.textContent = read ? '읽음' : '전송됨';
}
function paintTyping() {
  clearTimeout(typingTimer);
  const t = thread && thread.adminTyping ? thread.adminTyping.toMillis() : 0;
  const on = aiBusy || Date.now() - t < 5000;
  typing.classList.toggle('show', on);
  online.textContent = thread && thread.adminSeenAt && Date.now() - thread.adminSeenAt.toMillis() < 120000 ? '활동 중' : 'SYNDROME';
  online.classList.toggle('on', online.textContent === '활동 중');
  if (on) { body.scrollTop = body.scrollHeight; typingTimer = setTimeout(paintTyping, 5000 - (Date.now() - t)); }
}

ta.addEventListener('input', () => {
  btn.disabled = !ta.value.trim();
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  if (api && Date.now() - lastTypingSent > 2500) {
    lastTypingSent = Date.now();
    api.fs.setDoc(api.ref, { visitorTyping: api.fs.serverTimestamp() }, { merge: true }).catch(() => {});
  }
});
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); }
});
nm.addEventListener('change', () => { try { localStorage.setItem('whats-s-dm-name', nm.value.trim()); } catch (e) {} });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = ta.value.trim(); if (!text || !api) return;
  ta.value = ''; ta.style.height = 'auto'; btn.disabled = true;
  const { fs, ref, msgs } = api;
  const name = nm.value.trim().slice(0, 30);
  // 내가 아직 안 읽었으면 첫 메시지만, 단 마지막 알림 뒤 10분이 지났으면 다시 알림
  let lastPing = 0; try { lastPing = Number(localStorage.getItem('whats-s-dm-ping')) || 0; } catch (e) {}
  const firstUnread = !thread || !thread.unreadAdmin || Date.now() - lastPing > 600000;
  try {
    await fs.setDoc(ref, {
      name, last: text.slice(0, 120), lastFrom: 'v', updatedAt: fs.serverTimestamp(),
      unreadAdmin: fs.increment(1), visitorTyping: null, device: device(),
      ...(thread ? {} : { createdAt: fs.serverTimestamp() })
    }, { merge: true });
    await fs.addDoc(msgs, { from: 'v', text, at: fs.serverTimestamp() });
    if (firstUnread) notify();
  } catch (err) {
    console.error(err); ta.value = text; btn.disabled = false; note('전송에 실패했어요. 다시 시도해주세요.');
    setTimeout(() => note(''), 3000);
  }
});

// 내가 읽기 전까지는 대화방마다 첫 메시지 한 번만 알림
function notify() {
  if (!NTFY_TOPIC) return;
  try { localStorage.setItem('whats-s-dm-ping', String(Date.now())); } catch (e) {}
  const who = '방문자 #' + tid.slice(0, 4).toUpperCase();
  fetch('https://ntfy.sh/', {
    method: 'POST',
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: '💌 새 DM이 왔어요',
      message: who + ' · ' + device(),
      tags: ['syndrome_official'],
      click: new URL('../dm/inbox.html', location.href).href,
      priority: 4
    })
  }).catch(() => {});
}

// ── AI 자동답장 ──
// 마지막 메시지가 방문자 것이면 30초 뒤에 확인하고, 그 사이 내가 답하거나 입력 중이면 하지 않아요
function scheduleAi() {
  clearTimeout(aiTimer);
  const last = history[history.length - 1];
  if (!AI_URL || !last || last.from !== 'v') return;
  aiTimer = setTimeout(autoReply, Math.max(1000, AI_DELAY - (Date.now() - last.at)));
}
async function autoReply() {
  const last = history[history.length - 1];
  if (aiBusy || !api || !last || last.from !== 'v') return;
  const adminTyping = thread && thread.adminTyping ? Date.now() - thread.adminTyping.toMillis() < 8000 : false;
  if (adminTyping) { aiTimer = setTimeout(autoReply, 15000); return; }
  aiBusy = true; paintTyping();
  try {
    const r = await fetch(AI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-20).map((m) => ({ from: m.from, text: m.text })), name: nm.value.trim() })
    });
    const data = r.ok ? await r.json() : null;
    const now = history[history.length - 1];
    if (!data || !data.reply || !now || now.from !== 'v') return;
    const { fs, ref, msgs } = api;
    await fs.addDoc(msgs, { from: 'ai', text: data.reply, at: fs.serverTimestamp() });
    await fs.setDoc(ref, { last: data.reply.slice(0, 120), lastFrom: 'ai', updatedAt: fs.serverTimestamp() }, { merge: true });
  } catch (err) {
    console.error(err);
  } finally {
    aiBusy = false; paintTyping();
  }
}
