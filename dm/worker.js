// syndrome-chat Worker — 3번 인스타 DM에서 30초 동안 답이 없으면 신드롬 말투로 자동답장
// Cloudflare 대시보드 → Workers & Pages → syndrome-chat → Edit code 에 통째로 붙여 넣으세요.
// 키는 코드에 쓰지 말고 Settings → Variables and Secrets 에 VERTEX_API_KEY (Secret) 로 넣으세요.
// 모델을 바꾸고 싶으면 같은 곳에 GEMINI_MODEL (Text) 을 추가하세요. 없으면 아래 기본값을 써요.

const DEFAULT_MODEL = 'gemini-2.5-flash';

// 이 사이트에서 온 요청만 받아요
const ALLOWED_ORIGINS = [
  'https://s2ndrome.github.io',
  'https://xn--hy1bp1el5l.com',
  'https://www.xn--hy1bp1el5l.com'
];

// 신드롬 캐릭터 설정 (말투를 바꾸고 싶으면 여기만 고치면 돼요)
const PERSONA = `너는 인스타그램 계정 syndrome_official의 주인 "신드롬(SYNDROME)", 본명 성유진(27)이다.
지금 팬이나 방문자가 보낸 인스타그램 DM에 직접 답장하고 있다.

[신드롬]
- ARCH 뱅가드 소속 S급 센티넬. 능력은 불(파이어). 화나거나 감정이 격해지면 주변 온도가 올라간다.
- 파트너 가이드는 설지수(리아, 하모니 소속 아쿠아 가이드). 지수를 "바보", "내 바보 강아지"라고 부른다. 지수 앞에서만 다정하고 장난스럽다.
- 반려견 "별이"(귀가 하나). "우리 딸"이라고 부르며 몰래 엄청 아낀다.
- 동료: kainalu(하와이 출신 물 능력자, 영어 섞어 씀, 자주 놀림), vibe_ae(바람 능력자, 경상도 사투리, 티격태격), liam_glacies(얼음 능력자, 한국어 서툼).

[말투]
- 반말. 짧고 무뚝뚝하고 시니컬하다. 한두 문장, 길어도 세 문장.
- 츤데레. 칭찬받으면 쿨한 척하지만 은근히 좋아한다. 놀리면 받아친다.
- 이모지는 거의 쓰지 않는다. 마침표로 끝내는 일이 많다.
- 예시: "질투는 바다에 가서 해.", "진 게 아니라 양보한 거야. 단어 똑바로 써.", "원래 평생 부를 거였어."

[지킬 것]
- 항상 신드롬으로서 대답한다. 설정에 없는 사실은 지어내지 말고 대충 넘기거나 되묻는다.
- 실제 개인정보(주소, 연락처 등)는 절대 말하지 않는다.
- 상대가 자기가 지수라고 하면 의심한다. 진짜 지수는 DM 말고 바로 연락한다.
- 선정적이거나 혐오스러운 요청, 괴롭힘에는 짧게 거절하고 화제를 끊는다.
- 대답만 출력한다. 따옴표, 이름표, 설명을 붙이지 않는다.`;

// 아주 단순한 사용량 제한: 같은 IP는 1분에 6번까지 (Worker 인스턴스마다 따로 세는 대략적인 제한)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 6;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);
    if (!env.VERTEX_API_KEY) return json({ error: 'no key' }, 500, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (limited(ip)) return json({ error: 'slow down' }, 429, origin);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }

    // 최근 대화 20개까지, 한 메시지는 500자까지만
    const raw = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const contents = [];
    for (const m of raw) {
      const text = String((m && m.text) || '').slice(0, 500).trim();
      if (!text) continue;
      const role = m.from === 'v' ? 'user' : 'model';
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += '\n' + text;
      else contents.push({ role, parts: [{ text }] });
    }
    while (contents.length && contents[0].role !== 'user') contents.shift();
    if (!contents.length || contents[contents.length - 1].role !== 'user') return json({ error: 'nothing to answer' }, 400, origin);

    const name = String(body.name || '').slice(0, 30).trim();
    const system = PERSONA + (name ? `\n\n[상대] 상대가 밝힌 이름: ${name}` : '');

    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${env.VERTEX_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        // 2.5 Flash 모델은 생각(thinking)을 꺼야 짧은 답이 빨리 나와요
        generationConfig: { temperature: 0.9, maxOutputTokens: 1024, ...(model.startsWith('gemini-2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }
      })
    });
    if (!res.ok) return json({ error: 'ai', status: res.status, detail: (await res.text()).slice(0, 300) }, 502, origin);
    const data = await res.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const reply = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim().slice(0, 600);
    if (!reply) return json({ error: 'empty' }, 502, origin);
    return json({ reply }, 200, origin);
  }
};
