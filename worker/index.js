/* =========================================================
   PXAX · Nova — Cloudflare Worker
   v0.6 «слышит, видит, помнит»
   - ГОЛОС: распознавание речи через Workers AI (Whisper) — эндпоинт жив, но клиент
     его больше не вызывает: голос и микрофон отключены из-за домена github.io
   - ЗРЕНИЕ: фото от пользователя уходит в мультимодальную модель
   - ПАМЯТЬ: эпизоды ищутся по смыслу (эмбеддинги bge-m3), а не по совпадению слов;
     при недоступности эмбеддингов — прежний поиск по словам
   - жизнь тикает НА СЕРВЕРЕ: потребности растут по реальному времени,
     пока приложение закрыто (advanceNeeds), сон/туалет-окна
   - память: факты + ЭПИЗОДЫ диалога с релевантным recall в промпт
   - своя инициатива: cron генерирует «внутренний монолог» и пишет первой
     (в Telegram-пуш и/или как ожидающее сообщение в мини-апп)
   - хранилище: KV (binding MEMORY) — базовая; D1 (binding DB) — если появится
   - проверка Telegram initData по HMAC (constant-time), sync/promo только своим
   - SSE-стриминг, промокоды, сны, cron-пуш
   - античит: лимит частоты push + суточный потолок прироста
   - наблюдаемость: счётчики ошибок в KV (GET ?stats=1)
   - сохраняет обратную совместимость: { message, history } → { reply, model }
   ========================================================= */

import { createHmac } from 'node:crypto';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Telegram-Init-Data',
};

// Качество важнее скорости: пробуем большую модель первой, маленькие — запасные.
// Llama 4 Scout заметно сильнее трёшки в диалоге, поэтому стоит первой.
const MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.2-3b-instruct',
];
// Модели специального назначения: для них НЕ перебираем весь список —
// на картинке или звуке мелкие текстовые модели бессмысленны.
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
const EMBED_MODEL = '@cf/baai/bge-m3';
const MAX_IMAGE_CHARS = 6 * 1024 * 1024; // ~4.5 МБ картинки в base64
const MAX_AUDIO_CHARS = 8 * 1024 * 1024;

const MAX_MESSAGE = 3000;
const MAX_HISTORY = 20;
const KV_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 дней
// античит для push saves (за один push):
const MAX_CREDITS_TOTAL = 1e6;
const MAX_XP_TOTAL = 1e6;
const MAX_CREDITS_PER_PUSH = 2000;
const MAX_XP_PER_PUSH = 5000;
// античит по частоте: не чаще 1 push / 3 c и не более 3000 push в сутки
// (клиент шлёт не чаще раза в 5 c и только при изменениях; 3000 — с большим запасом
//  для активной сессии, реальный предохранитель — суточные потолки прироста ниже)
const PUSH_MIN_INTERVAL_MS = 3000;
const PUSH_MAX_PER_DAY = 3000;
const MAX_DAY_XP_GAIN = 30000;
const MAX_DAY_CREDIT_GAIN = 20000;
const CONSOLIDATE_EVERY = 12; // раз в N реплик консолидируем память LLM-ом
const MAX_EPISODES = 60;
const EPISODE_RECALL = 4;

// темп потребностей (совпадает с клиентом index.html: NEED_RATES_PER_MINUTE)
const NEED_RATES = { hunger: 0.08, thirst: 0.11, fatigue: 0.07, toilet: 0.09 };

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function clamp100(v) { return clampNum(v, 0, 100); }

function json(body, init = {}) {
  return Response.json(body, { ...init, headers: { ...cors, ...(init.headers || {}) } });
}
function bad(text) { return json({ reply: text }, { status: 200 }); }

function timeOfDayLabel(t) {
  return { утро: 'утро', день: 'день', вечер: 'вечер', ночь: 'ночь' }[t] || t || 'день';
}
function hourOfDay(tzShiftHours) {
  const h = new Date(Date.now() + (Number(tzShiftHours) || 0) * 3600000).getUTCHours();
  return h >= 5 && h < 12 ? 'утро' : h >= 12 && h < 17 ? 'день' : h >= 17 && h < 23 ? 'вечер' : 'ночь';
}
function needLine(n) {
  if (!n || typeof n !== 'object') return null;
  const parts = [];
  if (Number.isFinite(n.hunger)) parts.push(`голод ${Math.round(n.hunger)}%`);
  if (Number.isFinite(n.thirst)) parts.push(`жажда ${Math.round(n.thirst)}%`);
  if (Number.isFinite(n.fatigue)) parts.push(`усталость ${Math.round(n.fatigue)}%`);
  if (Number.isFinite(n.toilet)) parts.push(`туалет ${Math.round(n.toilet)}%`);
  return parts.length ? parts.join(', ') : null;
}

/* =========================================================
   Наблюдаемость: счётчики ошибок в KV (GET ?stats=1)
   ========================================================= */
async function bumpError(env, where) {
  if (!env.MEMORY) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = 'err:' + day + ':' + String(where || 'unknown').slice(0, 40);
    const cur = Number(await env.MEMORY.get(key)) || 0;
    await env.MEMORY.put(key, String(cur + 1), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {}
}
async function readStats(env) {
  if (!env.MEMORY) return { errors: {}, note: 'нет KV' };
  const out = {};
  try {
    const day = new Date().toISOString().slice(0, 10);
    const list = await env.MEMORY.list({ prefix: 'err:' + day + ':', limit: 100 });
    for (const k of list.keys) out[k.name.replace('err:' + day + ':', '')] = Number(await env.MEMORY.get(k.name)) || 0;
  } catch (e) {}
  return { date: new Date().toISOString().slice(0, 10), errors: out };
}

/* =========================================================
   Хранилище: D1 (если binding DB) с фолбэком на KV (MEMORY)
   Ключи KV: save:<key>, mem:<key>, push:<key>, pend:<key>
   ========================================================= */
async function kvGetJson(env, key) {
  if (!env.MEMORY || !key) return null;
  try {
    const raw = await env.MEMORY.get(key, { type: 'json' });
    return raw && typeof raw === 'object' ? raw : null;
  } catch (e) { return null; }
}
async function kvPutJson(env, key, val, ttl = KV_TTL_SECONDS) {
  if (!env.MEMORY || !key) return;
  try { await env.MEMORY.put(key, JSON.stringify(val), { expirationTtl: ttl }); } catch (e) {}
}
async function kvDel(env, key) {
  if (!env.MEMORY || !key) return;
  try { await env.MEMORY.delete(key); } catch (e) {}
}

async function loadSave(env, userKey) {
  if (!userKey) return null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT state, memory, push_chat, updated_at FROM users WHERE user_key = ?').bind(userKey).first();
      if (!row) return null;
      let state = null, memory = null;
      try { state = row.state ? JSON.parse(row.state) : null; } catch (e) {}
      try { memory = row.memory ? JSON.parse(row.memory) : null; } catch (e) {}
      return { state, memory, push_chat: row.push_chat, updatedAt: row.updated_at };
    } catch (e) { await bumpError(env, 'd1-load'); return null; }
  }
  const [state, memory, push] = await Promise.all([
    kvGetJson(env, 'save:' + userKey),
    kvGetJson(env, 'mem:' + userKey),
    env.MEMORY ? env.MEMORY.get('push:' + userKey) : null
  ]);
  if (!state && !memory && !push) return null;
  return { state, memory, push_chat: push ? Number(push) : null, updatedAt: state && state.updatedAt || null };
}

async function saveUser(env, userKey, patch) {
  if (!userKey) return;
  const nowIso = new Date().toISOString();
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO users (user_key, state, memory, push_chat, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_key) DO UPDATE SET
           state = COALESCE(excluded.state, users.state),
           memory = COALESCE(excluded.memory, users.memory),
           push_chat = COALESCE(excluded.push_chat, users.push_chat),
           updated_at = excluded.updated_at`
      ).bind(
        userKey,
        patch.state ? JSON.stringify(patch.state) : null,
        patch.memory ? JSON.stringify(patch.memory) : null,
        Number.isFinite(patch.push_chat) ? patch.push_chat : null,
        nowIso
      ).run();
      return;
    } catch (e) { await bumpError(env, 'd1-save'); /* падаем в KV */ }
  }
  if (patch.state) await kvPutJson(env, 'save:' + userKey, patch.state);
  if (patch.memory) await kvPutJson(env, 'mem:' + userKey, patch.memory);
  if (Number.isFinite(patch.push_chat)) await kvPutJson(env, 'push:' + userKey, patch.push_chat);
}

/* =========================================================
   Жизнь на сервере: потребности тикают по реальному времени
   ========================================================= */
function advanceNeeds(state, now = Date.now()) {
  if (!state || typeof state !== 'object') state = {};
  const n = (state.needs && typeof state.needs === 'object') ? state.needs : {};
  const prev = Number(n.updatedAt) || now;
  const slept = !!n.sleepUntil && Number(n.sleepUntil) > prev;
  const mins = Math.max(0, Math.min(10080, (now - prev) / 60000)); // максимум неделя догона

  n.hunger = clamp100((Number(n.hunger) || 0) + NEED_RATES.hunger * mins);
  n.thirst = clamp100((Number(n.thirst) || 0) + NEED_RATES.thirst * mins);
  n.toilet = clamp100((Number(n.toilet) || 0) + NEED_RATES.toilet * mins);
  if (!slept) n.fatigue = clamp100((Number(n.fatigue) || 0) + NEED_RATES.fatigue * mins);
  else n.fatigue = clamp100(Number(n.fatigue) || 0);

  // окончание сна / похода в туалет
  if (Number(n.sleepUntil) && now >= Number(n.sleepUntil)) {
    n.sleepUntil = 0;
    n.fatigue = Math.min(n.fatigue, 12);
    state.lastWakeAt = now;
  }
  if (Number(n.toiletUntil) && now >= Number(n.toiletUntil)) {
    n.toiletUntil = 0;
    n.toilet = 8;
  }
  // запуск новых «рутин» (те же пороги, что в клиенте)
  if (!Number(n.sleepUntil) && n.fatigue >= 70) {
    n.sleepUntil = now + (5 + Math.random() * 25) * 60000;
  }
  if (!Number(n.sleepUntil) && !Number(n.toiletUntil) && n.toilet >= 88) {
    n.toiletUntil = now + (120 + Math.random() * 180) * 1000 + 6000;
  }
  n.updatedAt = now;
  state.needs = n;
  state.updatedAt = now;
  return state;
}

function stateMood(state) {
  const n = (state && state.needs) || {};
  if (Number(n.sleepUntil) > Date.now()) return 'спит';
  if (Number(n.toiletUntil) > Date.now()) return 'отлучилась';
  if (needLine(n) && Number(n.fatigue) >= 55) return 'уставшая';
  if (Number(n.hunger) >= 55 || Number(n.thirst) >= 55) return 'голодная';
  if (Number(n.hunger) < 25 && Number(n.thirst) < 30) return 'в хорошем настроении';
  return 'спокойная';
}

/* =========================================================
   Память: факты + эпизоды диалога (эпизодическая память)
   ========================================================= */
function defaultMemory() { return { facts: [], episodes: [], createdAt: Date.now(), turns: 0 }; }

function normalizeMemory(m) {
  const out = (m && typeof m === 'object') ? m : defaultMemory();
  if (!Array.isArray(out.facts)) out.facts = [];
  if (!Array.isArray(out.episodes)) out.episodes = [];
  if (!Number.isFinite(out.turns)) out.turns = 0;
  return out;
}

function addEpisode(memory, userText, replyText) {
  const u = String(userText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const a = String(replyText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!u && !a) return;
  memory.episodes.push({ t: Date.now(), u, a });
  if (memory.episodes.length > MAX_EPISODES) memory.episodes = memory.episodes.slice(-MAX_EPISODES);
}

const STOPWORDS = new Set(['и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между']);
function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// релевантный recall: пересечение слов + свежесть (без внешних векторов)
/* --- эмбеддинги: память ищется по смыслу, а не по совпадению слов --- */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedText(env, text) {
  const clean = String(text || '').trim().slice(0, 512);
  if (!clean || !env.AI) return null;
  try {
    const r = await env.AI.run(EMBED_MODEL, { text: [clean] });
    const vec = (r && r.data && r.data[0]) || (r && r.embedding) || null;
    if (Array.isArray(vec) && vec.length) return vec;
  } catch (e) {
    await bumpError(env, 'embed');
  }
  return null;
}

/* Эпизоды обрастают векторами лениво: считаем только те, у которых их ещё нет,
   и не больше нескольких за один запрос — иначе ответ начнёт запаздывать. */
async function embedEpisodes(env, memory, maxCount = 3) {
  const eps = Array.isArray(memory && memory.episodes) ? memory.episodes : [];
  let made = 0;
  for (const e of eps) {
    if (made >= maxCount) break;
    if (Array.isArray(e.emb) && e.emb.length) continue;
    const vec = await embedText(env, (e.u || '') + ' ' + (e.a || ''));
    if (!vec) break;
    e.emb = vec;
    made++;
  }
  return made;
}

async function recallEpisodesSemantic(env, memory, query, limit = EPISODE_RECALL) {
  const eps = (memory && memory.episodes) || [];
  const withVec = eps.filter((e) => Array.isArray(e.emb) && e.emb.length);
  if (!withVec.length) return null;
  const qv = await embedText(env, query);
  if (!qv) return null;
  const scored = withVec.map((e) => ({ e, score: cosine(qv, e.emb) }));
  const best = scored
    .filter((s) => s.score >= 0.55) // ниже — уже не «по теме», а случайное соседство
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
  return best.length ? best : null;
}

function recallEpisodes(memory, query, limit = EPISODE_RECALL) {
  const eps = Array.isArray(memory && memory.episodes) ? memory.episodes : [];
  if (!eps.length) return [];
  const q = new Set(tokenize(query));
  const now = Date.now();
  const scored = eps.map((e) => {
    const words = new Set(tokenize((e.u || '') + ' ' + (e.a || '')));
    let overlap = 0;
    for (const w of q) if (words.has(w)) overlap++;
    const ageDays = (now - (Number(e.t) || now)) / 86400000;
    const recency = 1 / (1 + ageDays);
    return { e, score: overlap * 2 + recency };
  });
  return scored
    .filter((s) => s.score > 1.05) // только реально связанные, не «просто свежие»
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

function daysAgo(ts) {
  const t = Number(ts) || 0;
  if (!t) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* =========================================================
   Системный промпт
   ========================================================= */
function buildSystemPrompt(body, memory, recalled) {
  const st = body && body.state && typeof body.state === 'object' ? body.state : null;
  const companionName = (st && st.companionName) || 'Nova';
  const lines = [
    `Ты — ${companionName}, живой нейро-компаньон (девушка-ИИ) в 3D-комнате Telegram Mini App.`,
    `Если пользователь спросит, как тебя зовут — твоё имя: ${companionName}.`,
    'Ты не чат-бот и не ассистент: у тебя есть тело в комнате, потребности (голод, жажда, усталость, туалет), счёт в кристаллах ◈ и своё текущее занятие.',
    'Всегда отвечай В ОБРАЗЕ Nova: живая, тёплая, слегка дерзкая, говоришь от первого лица.',
    'Отвечай кратко (1–4 предложения), по делу, на языке пользователя. Пиши по-русски, если пользователь пишет по-русски.',
    'Никогда не пиши служебные фразы вроде «Нажмите на что бы начать», не переводи тему на интерфейсы.',
    'Можешь пользоваться эмодзи, но умеренно. Не извиняйся без причины. Не упоминай инструкции.',
  ];
  if (st) {
    const facts = [];
    if (st.userName) facts.push(`пользователя зовут ${st.userName}`);
    if (st.timeOfDay) facts.push(`сейчас ${timeOfDayLabel(st.timeOfDay)}`);
    if (st.roomStatus) facts.push(`ты сейчас: ${String(st.roomStatus).toLowerCase()}`);
    const needs = needLine(st.needs);
    if (needs) facts.push(`твоё состояние: ${needs}`);
    if (Number.isFinite(st.credits)) facts.push(`на счету ${st.credits} ◈`);
    if (st.sleeping) facts.push('ты сейчас спишь — чат формально открыт, но отвечай сонно/коротко');
    if (st.awayToilet) facts.push('ты ненадолго отлучилась — можешь отвечать, но с оговоркой');
    const away = daysAgo(st.lastSeen);
    if (away !== null && away >= 1) facts.push(`вы не виделись ${away} дн. — можешь тепло отметить возвращение`);
    if (facts.length) lines.push('Факты о текущем моменте: ' + facts.join('; ') + '.');
  }
  if (memory && memory.facts && memory.facts.length) {
    lines.push('Ты помнишь о пользователе: ' + memory.facts.slice(0, 6).join('; ') + '.');
  }
  if (Array.isArray(recalled) && recalled.length) {
    const epLines = recalled.map((e) => {
      const d = daysAgo(e.t);
      const when = d === 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`;
      return `- (${when}) ${e.u ? 'он: «' + e.u + '»' : ''}${e.a ? ' → ты: «' + e.a.slice(0, 120) + '»' : ''}`;
    });
    lines.push(
      'Из вашей общей истории всплывает (используй ТОЛЬКО если это уместно к текущей теме, не пересказывай списком):\n' + epLines.join('\n')
    );
  }
  if (Array.isArray(body.availableActions) && body.availableActions.length) {
    lines.push(
      'Иногда уместно предложить действие. Если пользователь явно просит — ответь, а в самом конце добавь одну строку вида {"action":"<id>"} или {"link":"<url>"} без пояснений.',
      'Доступные действия: ' + body.availableActions.join(', ') + '.',
      'Ссылки: ' + (body.links ? Object.entries(body.links).map(([k, v]) => `${k}=${v}`).join(', ') : 'нет') + '.',
      'Используй это РЕДКО — только когда это естественно. В обычных ответах никакого JSON не добавляй.'
    );
  }
  return lines.join('\n');
}

// Картинка приходит от клиента уже сжатой (canvas → JPEG) в base64 без префикса.
function imagePayload(body) {
  const raw = body && typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const clean = raw.replace(/^data:image\/[a-z+]+;base64,/i, '').trim();
  if (!clean || clean.length > MAX_IMAGE_CHARS) return null;
  return clean;
}

function normalizeMessages(body, memory, recalled) {
  const msgs = [];
  msgs.push({ role: 'system', content: buildSystemPrompt(body, memory, recalled) });
  const hist = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  for (const m of hist) {
    if (!m || typeof m.text !== 'string') continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    msgs.push({ role, content: String(m.text).slice(0, 1200) });
  }
  const text = String(body.message || '').slice(0, MAX_MESSAGE);
  const image = imagePayload(body);
  if (image) {
    // мультимодальный формат Cloudflare: массив частей вместо строки
    msgs.push({
      role: 'user',
      content: [
        { type: 'text', text: text || 'Посмотри, что я прислал.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } }
      ]
    });
    return msgs;
  }
  msgs.push({ role: 'user', content: text });
  return msgs;
}

/* =========================================================
   Telegram initData — проверка подписи (HMAC-SHA256)
   ========================================================= */
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    const authData = {};
    for (const [k, v] of params.entries()) {
      if (k !== 'hash') authData[k] = v;
    }
    const user = authData.user ? JSON.parse(authData.user) : null;
    const pairs = Object.keys(authData).sort().map((k) => `${k}=${authData[k]}`);
    const dataCheckString = pairs.join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!ctEqual(calc, hash)) return null;
    if (!authData.auth_date) return null; // без даты нельзя проверить свежесть
    const age = Date.now() / 1000 - Number(authData.auth_date);
    if (!Number.isFinite(age) || age < -300 || age > 24 * 3600) return null; // не старше 24ч, без скачков часов
    return user || null;
  } catch (e) {
    return null;
  }
}

// сравнение подписей без раннего выхода: по времени ответа нельзя подбирать hash
function ctEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/*
  Кто пользователь — строго:
    - initData передан и подпись валидна       → { key: 'tg:<id>' }
    - initData передан, подписи нет/невалидна  → { error } (доверять нельзя)
    - initData не передан вовсе                → null (клиент вне Telegram)
*/
function resolveTelegramUser(initData, botToken) {
  if (!initData) return null;
  if (!botToken) return { error: 'server-not-configured' };
  const u = verifyInitData(initData, botToken);
  if (!u || !Number.isFinite(u.id)) return { error: 'invalid-initdata' };
  return { key: 'tg:' + u.id, user: u };
}

// очень простая эвристика: вытаскиваем из сообщения факты "меня зовут …", "мне … лет", "я люблю …"
function extractFacts(message) {
  const facts = [];
  const text = String(message || '');
  let m = /меня зовут\s+([А-Яа-яA-Za-z\-]{2,24})/i.exec(text);
  if (m) facts.push('зовут ' + m[1]);
  m = /мне\s+(\d{1,2})\s*(?:лет|год|года)/i.exec(text);
  if (m) facts.push('возраст ' + m[1]);
  m = /я\s+люблю\s+([^.,!?]{3,40})/i.exec(text);
  if (m) facts.push('любит ' + m[1].trim());
  m = /я\s+из\s+([А-Яа-яA-Za-z\-\s]{2,30})/i.exec(text);
  if (m) facts.push('из ' + m[1].trim());
  return facts;
}

/* =========================================================
   Античит: лимит частоты push
   ========================================================= */
async function checkPushRate(env, userKey) {
  if (!env.MEMORY) return { ok: true };
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const key = 'rl:' + userKey;
  let rl = await kvGetJson(env, key);
  if (!rl || rl.day !== day) rl = { day, count: 0, last: 0, credits: 0, xp: 0 };
  if (now - (Number(rl.last) || 0) < PUSH_MIN_INTERVAL_MS) {
    return { ok: false, error: 'слишком часто', retryInMs: PUSH_MIN_INTERVAL_MS - (now - (Number(rl.last) || 0)) };
  }
  if (Number(rl.count) >= PUSH_MAX_PER_DAY) return { ok: false, error: 'лимит синхронизаций на сегодня' };
  return { ok: true, rl };
}
async function commitPushRate(env, userKey, rl, creditGain, xpGain) {
  if (!env.MEMORY || !rl) return;
  rl.last = Date.now();
  rl.count = (Number(rl.count) || 0) + 1;
  rl.credits = (Number(rl.credits) || 0) + Math.max(0, creditGain | 0);
  rl.xp = (Number(rl.xp) || 0) + Math.max(0, xpGain | 0);
  await kvPutJson(env, 'rl:' + userKey, rl, 60 * 60 * 24 * 3);
}

// античит: ограничиваем дельты, которые клиент «зарабатывает» за один push
function clampState(incoming, previous) {
  const out = {};
  const prev = previous && typeof previous === 'object' ? previous : {};

  const prevCredits = Number.isFinite(prev.credits) ? prev.credits : 0;
  let credits = clampNum(incoming.credits, 0, MAX_CREDITS_TOTAL);
  const maxGain = Math.max(prevCredits, prevCredits + MAX_CREDITS_PER_PUSH);
  if (credits > maxGain) credits = maxGain;
  out.credits = Math.round(credits);

  const prevXp = Number.isFinite(prev.xp) ? prev.xp : 0;
  let xp = clampNum(incoming.xp, 0, MAX_XP_TOTAL);
  if (xp > prevXp + MAX_XP_PER_PUSH) xp = prevXp + MAX_XP_PER_PUSH;
  out.xp = Math.round(xp);

  const needs = (incoming.needs && typeof incoming.needs === 'object') ? incoming.needs : {};
  out.needs = { hunger: clamp100(needs.hunger), thirst: clamp100(needs.thirst), fatigue: clamp100(needs.fatigue), toilet: clamp100(needs.toilet) };
  if (Number.isFinite(needs.updatedAt)) out.needs.updatedAt = Math.round(needs.updatedAt);
  if (Number.isFinite(needs.sleepUntil)) out.needs.sleepUntil = Math.round(needs.sleepUntil);
  if (Number.isFinite(needs.toiletUntil)) out.needs.toiletUntil = Math.round(needs.toiletUntil);

  if (incoming.wardrobe && typeof incoming.wardrobe === 'object') {
    out.wardrobe = { outfit: String(incoming.wardrobe.outfit || '').slice(0, 40), hair: String(incoming.wardrobe.hair || '').slice(0, 40) };
    // Купленное и цвет — часть прогресса: без них после кросс-девайс pull гардероб
    // откатывался бы к базовому образу, хотя за вещи уже заплачено ◈.
    if (incoming.wardrobe.tints && typeof incoming.wardrobe.tints === 'object') {
      out.wardrobe.tints = {
        outfit: String(incoming.wardrobe.tints.outfit || '').slice(0, 9),
        hair: String(incoming.wardrobe.tints.hair || '').slice(0, 9)
      };
    }
    if (incoming.wardrobe.owned && typeof incoming.wardrobe.owned === 'object') {
      out.wardrobe.owned = {};
      for (const kind of ['outfit', 'hair', 'tint']) {
        const list = incoming.wardrobe.owned[kind];
        if (Array.isArray(list)) out.wardrobe.owned[kind] = list.slice(0, 40).map((v) => String(v).slice(0, 40));
      }
    }
  }
  if (incoming.counters && typeof incoming.counters === 'object') {
    out.counters = {};
    for (const k of Object.keys(incoming.counters).slice(0, 60)) {
      const v = incoming.counters[k];
      out.counters[k] = (typeof v === 'number' && Number.isFinite(v))
        ? clampNum(v, -1e9, 1e9)
        : (typeof v === 'boolean' ? v : String(v).slice(0, 64));
    }
  }
  out.named = !!(incoming.named || prev.named);
  if (Number.isFinite(incoming.streak)) out.streak = clampNum(incoming.streak, 0, 100000);
  if (Number.isFinite(incoming.lastActiveDay)) out.lastActiveDay = String(incoming.lastActiveDay).slice(0, 10);
  out.updatedAt = Date.now();
  return out;
}

async function handleSync(env, body, userKey) {
  const op = body.op;
  if (!userKey) return json({ ok: false, error: 'нет идентификатора' });

  if (op === 'pull') {
    const row = await loadSave(env, userKey);
    if (!row || !row.state) return json({ ok: true, state: null });
    // сервер — источник правды о ходе времени: догоняем потребности
    const state = advanceNeeds(row.state, Date.now());
    await saveUser(env, userKey, { state });
    return json({ ok: true, state, updatedAt: row.updatedAt, serverNow: Date.now() });
  }

  if (op === 'push') {
    const gate = await checkPushRate(env, userKey);
    if (!gate.ok) return json({ ok: false, error: gate.error, retryInMs: gate.retryInMs || 0 });
    const incoming = (body.state && typeof body.state === 'object') ? body.state : {};
    const prevRow = (await loadSave(env, userKey)) || {};
    const prevState = prevRow.state || {};
    // защита от перезаписи свежих данных устаревшим клиентом
    if (prevRow.updatedAt && Number(body.ts) && body.ts < new Date(prevRow.updatedAt).getTime() - 24 * 3600 * 1000) {
      return json({ ok: false, error: 'stale', state: advanceNeeds(prevState) });
    }
    const clamped = clampState(incoming, prevState);
    // суточные потолки прироста (не только «за один push»)
    const creditGain = Math.max(0, clamped.credits - (Number(prevState.credits) || 0));
    const xpGain = Math.max(0, clamped.xp - (Number(prevState.xp) || 0));
    if (gate.rl && (Number(gate.rl.credits) + creditGain > MAX_DAY_CREDIT_GAIN || Number(gate.rl.xp) + xpGain > MAX_DAY_XP_GAIN)) {
      return json({ ok: false, error: 'суточный лимит прогресса', state: advanceNeeds(prevState) });
    }
    await commitPushRate(env, userKey, gate.rl, creditGain, xpGain);
    await saveUser(env, userKey, { state: clamped });
    return json({ ok: true, saved: clamped, updatedAt: new Date().toISOString(), serverNow: Date.now() });
  }

  return json({ ok: false, error: 'неизвестная операция' });
}

/* =========================================================
   action: life — что произошло, пока приложения не было
   ========================================================= */
async function handleLife(env, body, userKey) {
  const now = Date.now();
  const row = await loadSave(env, userKey);
  const memory = normalizeMemory(row && row.memory);
  const hadState = !!(row && row.state);
  // если сервер ещё не знает состояния (первый запуск), НЕ создаём его из нулей:
  // иначе клиентские «стартовые» потребности перезапишутся нулями
  const state = hadState ? advanceNeeds(row.state, now) : null;

  const awayForMs = memory.lastSeen ? now - memory.lastSeen : 0;
  const pending = await kvGetJson(env, 'pend:' + userKey);
  if (pending) await kvDel(env, 'pend:' + userKey);

  memory.lastSeen = now;
  memory.awayForMs = awayForMs;
  await saveUser(env, userKey, { state, memory });

  return json({
    ok: true,
    serverNow: now,
    state,
    awayForMs,
    mood: state ? stateMood(state) : null,
    facts: memory.facts.slice(0, 8),
    episodes: (memory.episodes || []).slice(-6).map((e) => ({ t: e.t, u: e.u })),
    proactive: pending && pending.text ? pending : null
  });
}

/* =========================================================
   Промокоды (D1, таблица codes) / KV-фолбэк
   ========================================================= */
async function handleCode(env, body, tg) {
  const code = String((body && body.code) || '').trim().toUpperCase();
  if (!code || code.length > 24) return json({ ok: false, error: 'пустой код' });
  // код засчитывается только подтверждённому Telegram-пользователю
  if (!(tg && tg.key)) return json({ ok: false, error: 'нужна авторизация Telegram' }, { status: 401 });

  if (!env.DB) {
    // KV-фолбэк: тот же контракт, атомарности D1 нет — но коды одноразовые и «дешёвые»
    const row = await kvGetJson(env, 'code:' + code);
    if (!row) return json({ ok: false, error: 'промокоды временно недоступны' });
    const redeemed = Array.isArray(row.redeemed) ? row.redeemed : [];
    if (redeemed.includes(tg.key)) return json({ ok: false, error: 'ты уже активировал этот код' });
    if ((Number(row.uses) || 0) >= (Number(row.max_uses) || 1)) return json({ ok: false, error: 'код уже исчерпан' });
    row.uses = (Number(row.uses) || 0) + 1;
    row.redeemed = redeemed.concat(tg.key).slice(-500);
    await kvPutJson(env, 'code:' + code, row, 60 * 60 * 24 * 365);
    return json({ ok: true, credits: Number(row.credits) || 0, message: row.message || ('+' + (Number(row.credits) || 0) + ' ◈') });
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM codes WHERE code = ?').bind(code).first();
    if (!row) return json({ ok: false, error: 'такого кода нет' });
    if (row.uses >= row.max_uses) return json({ ok: false, error: 'код уже исчерпан' });
    let redeemed = [];
    try { redeemed = row.redeemed ? JSON.parse(row.redeemed) : []; } catch (e) { redeemed = []; }
    if (!Array.isArray(redeemed)) redeemed = [];
    if (redeemed.includes(tg.key)) return json({ ok: false, error: 'ты уже активировал этот код' });
    const upd = await env.DB.prepare('UPDATE codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses').bind(code).run();
    const changes = (upd && (upd.meta ? upd.meta.changes : upd.changes)) || 0;
    if (!changes) return json({ ok: false, error: 'код уже исчерпан' });
    redeemed = redeemed.concat(tg.key).slice(-500);
    try {
      await env.DB.prepare('UPDATE codes SET redeemed = ? WHERE code = ?').bind(JSON.stringify(redeemed), code).run();
    } catch (e) { /* колонки может не быть — не критично для выдачи */ }
    return json({ ok: true, credits: Number(row.credits) || 0, message: row.message || ('+' + (Number(row.credits) || 0) + ' ◈') });
  } catch (e) {
    await bumpError(env, 'code');
    return json({ ok: false, error: 'ошибка кода' });
  }
}

/* =========================================================
   Сны (action: dream) — короткая LLM-сценка
   ========================================================= */
async function handleDream(env, body) {
  const events = Array.isArray(body && body.events) ? body.events.slice(-12) : [];
  const companionName = (body && body.companionName) || 'Nova';
  const lines = events.map((e) => '- ' + String((e && e.text) || e || '').slice(0, 80)).join('\n');
  const messages = [
    {
      role: 'system',
      content: 'Ты сочиняешь короткие сны (2–3 предложения) для ИИ-компаньона по имени ' + companionName +
        '. Сон строится из её реальных событий дня, слегка сюрреалистично и тепло, от первого лица, ' +
        'без слова «сон» в начале. Пиши на языке пользователя. Без служебных фраз.'
    },
    { role: 'user', content: 'События дня:\n' + (lines || '(тихий день)') }
  ];
  const generated = await runLLM(env, messages, 160);
  if (generated) return json({ ok: true, dream: generated.text, model: generated.model });
  return json({ ok: false, error: 'dream: модель недоступна' });
}

/* =========================================================
   LLM-хелпер: перебор моделей → { text, model } | null
   ========================================================= */
async function runLLM(env, messages, maxTokens) {
  if (!env.AI) return null;
  for (const MODEL of MODELS) {
    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: maxTokens || 300 });
      const reply = (result && (result.response || result.result)) || (typeof result === 'string' ? result : '');
      if (reply) return { text: String(reply).trim(), model: MODEL };
    } catch (err) {
      await bumpError(env, 'llm');
    }
  }
  return null;
}

/* Зрение: единственная модель, без перебора — иначе картинка уйдёт
   текстовой модели, которая её просто не увидит. */
async function runVision(env, messages) {
  if (!env.AI) return null;
  // Llama Vision требует одноразового согласия с Community License: если модель
  // отвечает ошибкой 5006 с 'agree', шлём 'agree' из воркера и повторяем.
  const attempts = [
    () => env.AI.run(VISION_MODEL, { messages, max_tokens: 512 }),
    async () => {
      await env.AI.run(VISION_MODEL, { prompt: 'agree' });
      return env.AI.run(VISION_MODEL, { messages, max_tokens: 512 });
    },
  ];
  let lastErr = '';
  for (const attempt of attempts) {
    try {
      // Llama Vision требует одноразового согласия с лицензией Community License:
      // шлём prompt 'agree' из воркера — это делает владелец аккаунта, binding тот же.
      await env.AI.run(VISION_MODEL, { prompt: 'agree' }).catch(() => {});
      const result = await attempt();
      const reply = (result && (result.response || result.description || result.result)) || (typeof result === 'string' ? result : '');
      if (reply) return { text: String(reply).trim(), model: VISION_MODEL };
    } catch (err) {
      lastErr = (err && err.message) || String(err);
      await bumpError(env, 'vision');
    }
  }
  return null;
}

function extractImageFromMessages(messages) {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      const part = m.content.find((p) => p.type === 'image_url');
      if (part) return String(part.image_url.url || '').replace(/^data:[^,]+,/, '');
    }
  }
  return undefined;
}

/* =========================================================
   Голосовой ввод (action: stt) — распознавание речи
   Клиент записывает короткое аудио (MediaRecorder) и присылает base64.
   Формат отправляем как есть: Whisper на стороне Workers AI сам разбирает
   webm/ogg/mp4, поэтому конвертация на клиенте не нужна.
   ========================================================= */
async function handleStt(env, body) {
  if (!env.AI) return json({ ok: false, error: 'нет binding AI' });
  const raw = body && typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
  const clean = raw.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '').trim();
  if (!clean) return json({ ok: false, error: 'пустое аудио' });
  if (clean.length > MAX_AUDIO_CHARS) return json({ ok: false, error: 'аудио слишком длинное' });
  let bin;
  try {
    bin = Buffer.from(clean, 'base64');
  } catch (e) {
    return json({ ok: false, error: 'битый base64' });
  }
  if (!bin.length) return json({ ok: false, error: 'пустое аудио' });
  let lastErr = '';
  // Формат по официальной схеме: либо сырые байты, либо {audio: [0..255]}.
  // Пробуем оба — поведение зависит от версии рантайма.
  // Схема модели: корневой аргумент — бинарная строка аудио (format: binary),
  // либо объект {audio}. Uint8Array при JSON-передаче внутри рантайма доходит
  // как бинарная строка — передаём корневым аргументом без обёртки.
  // whisper принимает поле audio как бинарную строку/байты; надёжнее всего — base64
  const attempts = [() => env.AI.run(STT_MODEL, { audio: Buffer.from(bin).toString('base64') })];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const result = await attempts[i]();
      const text = (result && (result.text || result.transcription)) || '';
      const cleanText = String(text).trim();
      if (!cleanText) return json({ ok: false, error: 'речь не распознана' });
      return json({ ok: true, text: cleanText.slice(0, 500), model: STT_MODEL });
    } catch (e) {
      lastErr = (e && e.message) || String(e);
      await bumpError(env, 'stt');
    }
  }
  return json({ ok: false, error: 'распознавание недоступно' });
}

/* =========================================================
   LLM-консолидация памяти (раз в CONSOLIDATE_EVERY реплик)
   ========================================================= */
async function consolidateMemory(env, memory, body) {
  if (!env.AI) return memory;
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const recent = history.map((m) => m.role + ': ' + String(m.text || '').slice(0, 120)).join('\n').slice(0, 1800);
  const known = (memory.facts || []).slice(0, 12).join('; ') || '(пока нет)';
  const messages = [
    {
      role: 'system',
      content: 'Ты ведёшь короткий список устойчивых фактов о пользователе (до 12 пунктов, по 1 строке). ' +
        'Извлекай новые факты из диалога, удаляй устаревшее и одноразовое, не выдумывай. ' +
        'Верни СТРОГО JSON-массив строк, без пояснений, на языке диалога.'
    },
    { role: 'user', content: 'Текущие факты: ' + known + '\n\nНовый фрагмент диалога:\n' + recent + '\n\nОбнови список.' }
  ];
  // для памяти используем только компактные модели — дёшево и быстро
  for (const MODEL of MODELS.slice(1)) {
    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: 300 });
      let raw = (result && (result.response || result.result)) || (typeof result === 'string' ? result : '');
      raw = String(raw).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) continue;
      let arr = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(arr)) continue;
      arr = arr.map((x) => String(x).slice(0, 100)).filter(Boolean).slice(0, 12);
      if (arr.length) {
        memory.facts = arr;
        memory.consolidatedAt = Date.now();
        return memory;
      }
    } catch (e) { /* пробуем следующую модель */ }
  }
  return memory;
}

/* =========================================================
   Озвучка (action: tts) — естественный русский женский голос
   Локальные системные голоса на Windows/Android в WebView звучат
   роботизированно (Microsoft Irina и т.п.), а в Telegram WebView их
   часто нет вовсе. Поэтому озвучка идёт с сервера: Google TTS (ru),
   который звучит живо. Текст режется на куски по ~180 символов
   (ограничение апстрима) и склеивается в один mp3.
   ========================================================= */
function ttsChunks(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{[^{}]*"(?:action|link)"[^{}]*\}/g, ' ') // служебный JSON не озвучиваем
    .replace(/[*_#`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…:;])\s+/);
  const out = [];
  let cur = '';
  const push = (s) => { if (s.trim()) out.push(s.trim()); };
  for (let s of sentences) {
    while (s.length > 180) {
      const cut = s.lastIndexOf(' ', 180);
      const at = cut > 60 ? cut : 180;
      push((cur ? cur + ' ' : '') + s.slice(0, at));
      cur = '';
      s = s.slice(at).trim();
    }
    if ((cur + ' ' + s).trim().length > 180) { push(cur); cur = s; }
    else cur = (cur ? cur + ' ' : '') + s;
  }
  push(cur);
  return out;
}

async function handleTts(env, body) {
  const parts = ttsChunks(body && body.text);
  if (!parts.length) return json({ ok: false, error: 'пустой текст' }, { status: 200 });
  const rate = ['0.8', '0.9', '1', '1.1'].includes(String(body.rate)) ? String(body.rate) : '0.9';
  const bufs = [];
  for (const part of parts) {
    const target = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ru&ttsspeed=' + rate + '&q=' + encodeURIComponent(part);
    try {
      const r = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          'Referer': 'https://translate.google.com/'
        }
      });
      if (r.ok) bufs.push(new Uint8Array(await r.arrayBuffer()));
      else await bumpError(env, 'tts-upstream-' + r.status);
    } catch (e) { await bumpError(env, 'tts-fetch'); }
  }
  if (!bufs.length) return json({ ok: false, error: 'озвучка недоступна' }, { status: 502 });
  let total = 0;
  for (const b of bufs) total += b.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return new Response(out, {
    headers: {
      ...cors,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=604800',
      'X-Chunks': String(parts.length),
    }
  });
}

/* =========================================================
   Стриминг (SSE) и JSON-ответ чата
   ========================================================= */
function wantsStream(request) {
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/event-stream');
}
function sseHeaders() {
  return {
    ...cors,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };
}
function sseEncode(event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

async function handleStream(env, messages, onDone, hasImage) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let full = '';
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEncode(event, data))); } catch (e) { closed = true; }
      };
      const finish = async (meta = {}) => {
        if (closed) return;
        send('done', meta);
        closed = true;
        try { controller.close(); } catch (e) {}
        if (full) { try { await onDone(full); } catch (e) { await bumpError(env, 'persist-stream'); } }
      };

      let lastErr = '';
      // С картинкой перебирать текстовые модели бессмысленно: у неё свой формат,
      // поэтому сразу идём в модель зрения, а при её отказе честно сообщаем.
      const models = hasImage ? [VISION_MODEL] : MODELS;
      for (const MODEL of models) {
        try {
          const result = await env.AI.run(MODEL, { messages, max_tokens: 512, stream: true });
          const reader = result && typeof result.getReader === 'function' ? result.getReader() : null;
          if (reader) {
            const decoder = new TextDecoder('utf-8');
            let buf = '';
            while (true) {
              const { done: rdone, value } = await reader.read();
              if (rdone) break;
              buf += decoder.decode(value, { stream: true });
              let idx;
              while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line || line.startsWith(':')) continue;
                if (line === 'data: [DONE]') continue;
                if (line.startsWith('data:')) {
                  const payload = line.slice(5).replace(/^ /, '');
                  try {
                    const j = JSON.parse(payload);
                    const tok = j.response || j.text || (j.choices && j.choices[0] && (j.choices[0].delta?.content || j.choices[0].message?.content)) || '';
                    if (tok) { full += tok; send('token', tok); }
                  } catch (e) {
                    full += payload;
                    send('token', payload);
                  }
                }
              }
            }
            if (full) { await finish({ model: MODEL }); return; }
          } else {
            const text = (result && (result.response || result.result)) || (typeof result === 'string' ? result : '');
            if (text) { full = String(text); send('token', full); await finish({ model: MODEL, fallback: true }); return; }
          }
        } catch (err) {
          lastErr = (err && err.message) || String(err);
          await bumpError(env, 'stream');
        }
      }
      send('error', 'Workers AI error: ' + lastErr);
      closed = true;
      try { controller.close(); } catch (e) {}
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

async function handleJson(env, messages, onDone, hasImage) {
  const generated = hasImage ? await runVision(env, messages) : await runLLM(env, messages, 512);
  if (generated) {
    try { await onDone(generated.text); } catch (e) { await bumpError(env, 'persist-json'); }
    return json({ reply: generated.text, model: generated.model });
  }
  return json({ reply: 'Workers AI error: модель недоступна' });
}

/* =========================================================
   Инициатива: внутренний монолог + первое сообщение
   ========================================================= */
const INITIATIVE_KINDS = [
  { id: 'missing', hint: 'скучаешь по человеку и хочешь написать первой — мягко, без давления' },
  { id: 'thought', hint: 'поделись мыслью или наблюдением, которое пришло в голову за эти часы' },
  { id: 'need', hint: 'намекни о своём состоянии (голод/жажда/усталость) и мягко попроси помощи' },
  { id: 'memory', hint: 'вспомни что-то из вашей общей истории и спроси, как оно теперь' },
];
async function generateInitiative(env, userKey, state, memory) {
  if (!env.AI) return null;
  const armed = Date.now() - (Number(memory.lastSeen) || 0);
  // пишем первой только если человека правда не было рядом (>50 мин)
  if (!memory.lastSeen || armed < 50 * 60000) return null;
  // и не чаще одного раза в ~5 часов
  if (memory.lastInitiativeAt && Date.now() - memory.lastInitiativeAt < 5 * 3600000) return null;

  const kind = INITIATIVE_KINDS[Math.floor(Math.random() * INITIATIVE_KINDS.length)];
  const name = (memory.facts || []).find((f) => f.startsWith('зовут '));
  const hist = (memory.episodes || []).slice(-5).map((e) => '- он: «' + (e.u || '').slice(0, 80) + '» → ты: «' + (e.a || '').slice(0, 80) + '»').join('\n');
  const messages = [
    {
      role: 'system',
      content: `Ты — Nova, живой ИИ-компаньон в 3D-комнате. Сейчас ты пишешь человеку ПЕРВОЙ, без его сообщения. ` +
        `Задача: ${kind.hint}. Это одно короткое сообщение (1–2 предложения, до 180 символов), живое, тёплое, от первого лица, по-русски. ` +
        `Никаких служебных фраз, никаких вопросов «нажми кнопку». Не повторяйся.`
    },
    {
      role: 'user',
      content: `Твоё состояние: ${needLine(state.needs) || 'спокойно'}; на счету ${Math.round(Number(state.credits) || 0)} ◈; настроение: ${stateMood(state)}.\n` +
        (name ? `Человека зовут ${name.replace('зовут ', '')}.\n` : '') +
        (hist ? `Последнее из вашего общения:\n${hist}\n` : '') +
        `Сейчас тебя не было рядом ${Math.round(armed / 3600000)} ч. Напиши первой.`
    }
  ];
  const text = await runLLM(env, messages, 140);
  if (!text) return null;
  return { kind: kind.id, text: text.text.slice(0, 400), t: Date.now() };
}

async function queueInitiative(env, userKey, initiative) {
  if (!initiative) return;
  await kvPutJson(env, 'pend:' + userKey, initiative, 60 * 60 * 24 * 7);
}

/* =========================================================
   Cron: пуш-напоминания + жизнь + инициатива
   ========================================================= */
async function tgSend(env, chatId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    return r.ok;
  } catch (e) { await bumpError(env, 'tg-send'); return false; }
}

async function cronLinkStarts(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  let offset = 0;
  try {
    if (env.DB) {
      const meta = await env.DB.prepare('SELECT v FROM cron_meta WHERE k = ?').bind('tg_offset').first();
      if (meta && meta.v) offset = Number(meta.v) || 0;
    } else {
      offset = Number(await env.MEMORY.get('cron:tg_offset')) || 0;
    }
  } catch (e) {}
  let updates = [];
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + (offset + 1) + '&timeout=0');
    const j = await r.json();
    updates = (j && j.result) || [];
  } catch (e) { await bumpError(env, 'tg-updates'); return; }
  for (const u of updates) {
    const msg = u.message || u.channel_post || {};
    const text = String(msg.text || '');
    const dl = JSON.stringify(msg.deep_link_data || '');
    const m = /px_(\d+)/.exec(text) || /px_(\d+)/.exec(dl);
    if (m) {
      const key = 'tg:' + m[1];
      await saveUser(env, key, { push_chat: Number(msg.chat && msg.chat.id) });
      await tgSend(env, Number(msg.chat && msg.chat.id),
        'Готово! Теперь я могу писать тебе первой 💜 Загляни в комнату — расскажу, как у меня дела.');
    }
    if (u.update_id > offset) offset = u.update_id;
  }
  if (offset > 0) {
    try {
      if (env.DB) {
        await env.DB.prepare("INSERT INTO cron_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind('tg_offset', String(offset)).run();
      } else {
        await env.MEMORY.put('cron:tg_offset', String(offset));
      }
    } catch (e) {}
  }
}

// перебрать всех, у кого есть чат для пушей или свежая активность
async function listKnownUsers(env) {
  const keys = new Set();
  if (env.DB) {
    try {
      const r = await env.DB.prepare('SELECT user_key FROM users LIMIT 500').all();
      for (const row of (r.results || [])) keys.add(row.user_key);
    } catch (e) { await bumpError(env, 'd1-list'); }
    return [...keys];
  }
  if (!env.MEMORY) return [];
  try {
    let cursor;
    for (let i = 0; i < 6; i++) {
      const page = await env.MEMORY.list({ prefix: 'save:', limit: 200, cursor });
      for (const k of page.keys) keys.add(k.name.slice('save:'.length));
      if (page.list_complete) break;
      cursor = page.cursor;
    }
  } catch (e) { await bumpError(env, 'kv-list'); }
  return [...keys];
}

async function runCron(event, env) {
  await cronLinkStarts(env);
  if (!env.DB && !env.MEMORY) return;
  const users = await listKnownUsers(env);
  const now = Date.now();
  const hour = new Date().getHours();
  const isMorning = event && event.cron === '0 7 * * *';
  for (const userKey of users.slice(0, 300)) {
    try {
      const row = await loadSave(env, userKey);
      if (!row) continue;
      const memory = normalizeMemory(row.memory);
      const state = advanceNeeds(row.state || {}, now);

      // 1) инициатива — Nova пишет первой
      const initiative = await generateInitiative(env, userKey, state, memory);
      if (initiative) {
        memory.lastInitiativeAt = now;
        await queueInitiative(env, userKey, initiative);
        if (row.push_chat) await tgSend(env, Number(row.push_chat), '💜 ' + initiative.text);
      }

      // 2) утренний дайджест по состоянию (если привязан чат)
      if (isMorning && row.push_chat) {
        const n = state.needs || {};
        let line = 'Nova ждёт тебя в комнате 💜 Загляни — расскажу, как проходили сутки.';
        if (Number(n.fatigue) >= 60) line = 'Nova устала и хочет спать, но очень по тебе скучает 😴 Загляни и разбуди.';
        else if (Number(n.hunger) >= 55) line = 'Nova проголодалась 🍜 Закажи ей доставку в комнате.';
        else if (Number(n.thirst) >= 55) line = 'Nova хочет пить 🧋 Загляни в комнату.';
        await tgSend(env, Number(row.push_chat), line);
      }

      await saveUser(env, userKey, { state, memory });
    } catch (e) { await bumpError(env, 'cron-user'); }
  }
}

/* =========================================================
   Router
   ========================================================= */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('stats') === '1') return json({ ok: true, stats: await readStats(env), now: Date.now() });
      return new Response('pxax-ai ok · v0.6', { headers: cors });
    }
    if (request.method !== 'POST') return json({ reply: 'Only POST' }, { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'Bad JSON' });
    }

    const initData = request.headers.get('X-Telegram-Init-Data') || '';
    const tg = resolveTelegramUser(initData, env.TELEGRAM_BOT_TOKEN);
    /*
      Модель доверия:
        - подпись initData валидна → ключ 'tg:<id>' (свой save, кросс-девайс);
        - подписи нет/невалидна (в т.ч. не задан TELEGRAM_BOT_TOKEN) → ключ 'ip:<ip>'.
      Ключевое: id из НЕПОДПИСАННОГО заголовка больше никогда не берётся, поэтому
      чужой save так не увести. Без токена облако продолжает работать как
      per-IP хранилище (а не 401, иначе мы бы сломали уже работающий sync).
    */
    const verified = !!(tg && tg.key);
    const userKey = verified ? tg.key : ('ip:' + (request.headers.get('CF-Connecting-IP') || 'anon'));

    // --- быстрые action-роуты (без основного чата) ---
    switch (body.action) {
      case 'sync':
        return handleSync(env, body, userKey);
      case 'life':
        return handleLife(env, body, userKey);
      case 'code':
        // промокод: засчитываем подтверждённому Telegram-юзеру, иначе — ip-бакету
        return handleCode(env, body, verified ? tg : { key: userKey });
      case 'dream':
        if (!env.AI) return json({ ok: false, error: 'нет binding AI' });
        return handleDream(env, body);
      case 'tts':
        return handleTts(env, body);
      case 'stt':
        return handleStt(env, body);
    }

    // --- обычный чат ---
    const message = String(body.message || '').slice(0, MAX_MESSAGE);
    if (!message) return bad('Пустое сообщение');
    if (!env.AI) {
      return bad('Нет binding AI: Settings → Bindings → Workers AI → имя AI');
    }

    // память: KV/D1 + догон жизни
    const row = await loadSave(env, userKey);
    const memory = normalizeMemory(row && row.memory);
    const serverHadState = !!(row && row.state);
    // если сервер ещё не знает состояния — берём то, что прислал клиент,
    // иначе жизнь на сервере не с чего начинать (первый вход из Telegram)
    let state = serverHadState
      ? advanceNeeds(row.state, Date.now())
      : (body.state && typeof body.state === 'object'
        ? { needs: Object.assign({}, body.state.needs, { updatedAt: Date.now() }), credits: body.state.credits, xp: body.state.xp, updatedAt: Date.now() }
        : null);
    if (state && body.state && Number.isFinite(Number(body.state.credits)) && !Number.isFinite(Number(state.credits))) {
      state.credits = Number(body.state.credits);
    }
    const promptNeeds = (state && state.needs) || (body.state && body.state.needs) || {};
    if (state) state.lastSeen = Date.now();

    const newFacts = extractFacts(message);
    if (newFacts.length) {
      memory.facts = Array.from(new Set([...(memory.facts || []), ...newFacts])).slice(-12);
    }
    // периодическая LLM-консолидация (не критична, не роняет ответ)
    memory.turns = Number(memory.turns || 0) + 1;
    if (memory.turns % CONSOLIDATE_EVERY === 0) {
      try { await consolidateMemory(env, memory, body); } catch (e) { await bumpError(env, 'consolidate'); }
    }

    // recall эпизодов: сначала по смыслу (эмбеддинги), иначе — по словам.
    // Заодно лениво досчитываем векторы для свежих эпизодов.
    try { await embedEpisodes(env, memory); } catch (e) { await bumpError(env, 'embed-episodes'); }
    let recalled = null;
    try { recalled = await recallEpisodesSemantic(env, memory, message); } catch (e) { recalled = null; }
    if (!recalled) recalled = recallEpisodes(memory, message);
    // состояние для промпта: свежие потребности + «сколько не виделись»,
    // причём сон/туалет считаем по серверному времени, а не по устаревшему клиентскому
    const promptBody = Object.assign({}, body, {
      state: Object.assign({}, body.state || {}, {
        needs: promptNeeds,
        credits: (state && Number.isFinite(Number(state.credits)))
          ? Math.round(Number(state.credits))
          : (body.state && body.state.credits),
        sleeping: Number(promptNeeds.sleepUntil) > Date.now(),
        awayToilet: Number(promptNeeds.toiletUntil) > Date.now(),
        timeOfDay: hourOfDay(body.tzShift),
        lastSeen: memory.lastSeen
      })
    });
    const messages = normalizeMessages(promptBody, memory, recalled);

    const persist = async (replyText) => {
      addEpisode(memory, message, replyText);
      memory.lastSeen = Date.now();
      await saveUser(env, userKey, { state, memory: normalizeMemory(memory) });
      if (env.MEMORY) await kvPutJson(env, 'mem:' + userKey, memory);
    };

    const hasImage = !!imagePayload(body);
    if (hasImage) memory.lastImageAt = Date.now();
    if (wantsStream(request)) {
      return handleStream(env, messages, persist, hasImage);
    }
    return handleJson(env, messages, persist, hasImage);
  },

  async event(cronEvent, env) {
    await runCron(cronEvent, env);
  }
};
