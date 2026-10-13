// 3번 인스타 '메시지' → 방문자와 1:1 실시간 DM (Firebase 익명 로그인 + Firestore)
import { firebaseConfig } from './firebase-config.js?v=10131351';

const V = '10.12.2';
const $ = (id) => document.getElementById(id);
const dm = $('dm'), body = $('dmBody'), list = $('dmList'), form = $('dmForm'), ta = $('dmText'), btn = $('dmSend'),
  nm = $('dmName'), typing = $('dmTyping'), state = $('dmState'), online = $('dmOnline');

let api = null, ready = null, tid = null, thread = null, lastSeenEl = null, typingTimer = null, lastTypingSent = 0;

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
  if (m.from === 'a') {
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
    snap.forEach((doc) => { const m = doc.data(); const el = bubble(m); list.appendChild(el); if (m.from === 'v') lastMine = { el, at: m.at }; else lastMine = null; });
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
  const on = Date.now() - t < 5000;
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
  try {
    await fs.setDoc(ref, {
      name, last: text.slice(0, 120), lastFrom: 'v', updatedAt: fs.serverTimestamp(),
      unreadAdmin: fs.increment(1), visitorTyping: null,
      ...(thread ? {} : { createdAt: fs.serverTimestamp() })
    }, { merge: true });
    await fs.addDoc(msgs, { from: 'v', text, at: fs.serverTimestamp() });
  } catch (err) {
    console.error(err); ta.value = text; btn.disabled = false; note('전송에 실패했어요. 다시 시도해주세요.');
    setTimeout(() => note(''), 3000);
  }
});
