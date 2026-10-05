/* =========================================================
   PXAX · Nova — Cloudflare Worker
   - понимает состояние персонажа (needs, roomStatus, timeOfDay)
   - SSE-стриминг, если клиент принимает (Accept: text/event-stream)
   - опциональная память через Workers KV (binding MEMORY)
   - saves между устройствами через D1 (binding DB, таблица users)
   - проверка Telegram initData (HMAC-SHA256), если задан TELEGRAM_BOT_TOKEN
   - LLM-консолидация памяти пользователя (раз в N реплик)
   - промокоды (таблица codes), сны (action: dream), cron-пуш в TG
   - graceful fallback на старый формат { message, history }
   ========================================================= */

import { createHmac } from 'node:crypto';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Telegram-Init-Data',
};

// Качество важнее скорости: пробуем большую модель первой, маленькие — запасные.
const MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.2-3b-instruct',
];

const MAX_MESSAGE = 3000;
const MAX_HISTORY = 20;
const KV_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 дней
// антисбот-лимиты для push saves (за один push):
const MAX_CREDITS_TOTAL = 1e6;
const MAX_XP_TOTAL = 1e6;
const MAX_CREDITS_PER_PUSH = 2000;
const MAX_XP_PER_PUSH = 5000;
const CONSOLIDATE_EVERY = 12; // раз в N реплик консолидируем память LLM-ом

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function json(body, init = {}) {
  return Response.json(body, { ...init, headers: { ...cors, ...(init.headers || {}) } });
}

function bad(text) { return json({ reply: text }, { status: 200 }); }

function timeOfDayLabel(t) {
  return { утро: 'утро', день: 'день', вечер: 'вечер', ночь: 'ночь' }[t] || t || 'день';
}

function needLine(n) {
  if (!n || typeof n !== 'object') return null;
  const parts = [];
  if (Number.isFinite(n.hunger)) parts.push(`голод ${n.hunger}%`);
  if (Number.isFinite(n.thirst)) parts.push(`жажда ${n.thirst}%`);
  if (Number.isFinite(n.fatigue)) parts.push(`усталость ${n.fatigue}%`);
  if (Number.isFinite(n.toilet)) parts.push(`туалет ${n.toilet}%`);
  return parts.length ? parts.join(', ') : null;
}

function buildSystemPrompt(body, memory) {
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
    if (facts.length) lines.push('Факты о текущем моменте: ' + facts.join('; ') + '.');
  }
  if (memory && memory.facts && memory.facts.length) {
    lines.push('Ты помнишь о пользователе: ' + memory.facts.slice(0, 6).join('; ') + '.');
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

function normalizeMessages(body, memory) {
  const msgs = [];
  const sys = buildSystemPrompt(body, memory);
  msgs.push({ role: 'system', content: sys });
  const hist = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  for (const m of hist) {
    if (!m || typeof m.text !== 'string') continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    msgs.push({ role, content: String(m.text).slice(0, 1200) });
  }
  msgs.push({ role: 'user', content: String(body.message || '').slice(0, MAX_MESSAGE) });
  return msgs;
}

async function readMemory(env, userKey) {
  if (!env.MEMORY || !userKey) return null;
  try {
    const raw = await env.MEMORY.get(userKey, { type: 'json' });
    if (raw && typeof raw === 'object') return raw;
  } catch (e) {}
  return null;
}

async function writeMemory(env, userKey, memory) {
  if (!env.MEMORY || !userKey) return;
  try {
    await env.MEMORY.put(userKey, JSON.stringify(memory), { expirationTtl: KV_TTL_SECONDS });
  } catch (e) {}
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
    if (calc !== hash) return null;
    const age = authData.auth_date ? Date.now() / 1000 - Number(authData.auth_date) : 0;
    if (age > 24 * 3600) return null; // initData старше 24ч не принимаем
    return user || null;
  } catch (e) {
    return null;
  }
}

function userKeyFromInitData(initData, botToken) {
  if (botToken) {
    const u = verifyInitData(initData, botToken);
    if (u && Number.isFinite(u.id)) return 'tg:' + u.id;
  }
  const m = /"id"\s*:\s*(\d+)/.exec(initData || '');
  if (m) return 'tg:' + m[1];
  return null;
}

/* =========================================================
   Saves между устройствами (D1, binding DB)
   ========================================================= */
async function loadSave(env, userKey) {
  if (!env.DB || !userKey) return null;
  try {
    const row = await env.DB.prepare('SELECT state, memory, push_chat, updated_at FROM users WHERE user_key = ?').bind(userKey).first();
    if (!row) return null;
    let state = null;
    let memory = null;
    try { state = row.state ? JSON.parse(row.state) : null; } catch (e) { state = null; }
    try { memory = row.memory ? JSON.parse(row.memory) : null; } catch (e) { memory = null; }
    return { state, memory, push_chat: row.push_chat, updatedAt: row.updated_at };
  } catch (e) { return null; }
}

async function saveUser(env, userKey, patch) {
  if (!env.DB || !userKey) return;
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO users (user_key, state, memory, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key) DO UPDATE SET
         state = COALESCE(excluded.state, users.state),
         memory = COALESCE(excluded.memory, users.memory),
         updated_at = excluded.updated_at`
    ).bind(
      userKey,
      patch.state ? JSON.stringify(patch.state) : null,
      patch.memory ? JSON.stringify(patch.memory) : null,
      now
    ).run();
  } catch (e) { /* ignore */ }
}

// антисбот: ограничиваем дельты, которые клиент «зарабатывает» за один push
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
  out.needs = {
    hunger: clampNum(needs.hunger, 0, 100),
    thirst: clampNum(needs.thirst, 0, 100),
    fatigue: clampNum(needs.fatigue, 0, 100),
    toilet: clampNum(needs.toilet, 0, 100)
  };
  if (Number.isFinite(needs.updatedAt)) out.needs.updatedAt = Math.round(needs.updatedAt);
  if (Number.isFinite(needs.sleepUntil)) out.needs.sleepUntil = Math.round(needs.sleepUntil);
  if (Number.isFinite(needs.toiletUntil)) out.needs.toiletUntil = Math.round(needs.toiletUntil);

  if (incoming.wardrobe && typeof incoming.wardrobe === 'object') {
    out.wardrobe = {
      outfit: String(incoming.wardrobe.outfit || '').slice(0, 40),
      hair: String(incoming.wardrobe.hair || '').slice(0, 40)
    };
  }
  if (incoming.counters && typeof incoming.counters === 'object') {
    out.counters = {};
    for (const k of Object.keys(incoming.counters).slice(0, 40)) {
      const v = incoming.counters[k];
      out.counters[k] = (typeof v === 'number' && Number.isFinite(v))
        ? clampNum(v, -1e9, 1e9)
        : (typeof v === 'boolean' ? v : String(v).slice(0, 64));
    }
  }
  out.named = !!(incoming.named || prev.named);
  return out;
}

async function handleSync(env, body, userKey) {
  const op = body.op;
  if (!userKey) return json({ ok: false, error: 'нет идентификатора' });

  if (op === 'pull') {
    const row = await loadSave(env, userKey);
    if (!row || !row.state) return json({ ok: true, state: null });
    return json({ ok: true, state: row.state, updatedAt: row.updatedAt });
  }

  if (op === 'push') {
    const incoming = (body.state && typeof body.state === 'object') ? body.state : {};
    const prevRow = (await loadSave(env, userKey)) || {};
    // защита от перезаписи свежих данных устаревшим клиентом
    if (prevRow.updatedAt && Number(body.ts) && body.ts < new Date(prevRow.updatedAt).getTime() - 24 * 3600 * 1000) {
      return json({ ok: false, error: 'stale', state: prevRow.state });
    }
    const clamped = clampState(incoming, prevRow.state || {});
    await saveUser(env, userKey, { state: clamped });
    return json({ ok: true, saved: clamped, updatedAt: new Date().toISOString() });
  }

  return json({ ok: false, error: 'неизвестная операция' });
}


/* =========================================================
   Промокоды (D1, таблица codes)
   ========================================================= */
async function handleCode(env, body) {
  const code = String((body && body.code) || '').trim().toUpperCase();
  if (!code || code.length > 24) return json({ ok: false, error: 'пустой код' });
  if (!env.DB) return json({ ok: false, error: 'промокоды временно недоступны' });
  try {
    const row = await env.DB.prepare('SELECT * FROM codes WHERE code = ?').bind(code).first();
    if (!row) return json({ ok: false, error: 'такого кода нет' });
    if (row.uses >= row.max_uses) return json({ ok: false, error: 'код уже исчерпан' });
    await env.DB.prepare('UPDATE codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses').bind(code).run();
    return json({
      ok: true,
      credits: Number(row.credits) || 0,
      message: row.message || ('+' + (Number(row.credits) || 0) + ' ◈')
    });
  } catch (e) {
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
  let lastErr = '';
  for (const MODEL of MODELS) {
    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: 160 });
      const reply = (result && (result.response || result.result)) || (typeof result === 'string' ? result : '');
      if (reply) return json({ ok: true, dream: String(reply).trim(), model: MODEL });
    } catch (err) { lastErr = (err && err.message) || String(err); }
  }
  return json({ ok: false, error: 'dream: ' + lastErr });
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

async function handleStream(request, env, messages, userKey, memory) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let full = '';
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEncode(event, data))); } catch (e) { closed = true; }
      };
      const done = async (meta = {}) => {
        if (closed) return;
        send('done', meta);
        closed = true;
        try { controller.close(); } catch (e) {}
        // пишем память в фоне
        if (userKey && memory) {
          memory.updatedAt = Date.now();
          await writeMemory(env, userKey, memory);
          await saveUser(env, userKey, { memory });
        }
      };

      let lastErr = '';
      for (const MODEL of MODELS) {
        try {
          const result = await env.AI.run(MODEL, {
            messages,
            max_tokens: 512,
            stream: true,
          });
          // result — ReadableStream (Workers AI) или async-iterable
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
                  const payload = line.slice(5).trim();
                  try {
                    const j = JSON.parse(payload);
                    const tok = j.response || j.text || (j.choices && j.choices[0] && (j.choices[0].delta?.content || j.choices[0].message?.content)) || '';
                    if (tok) { full += tok; send('token', tok); }
                  } catch (e) {
                    // не JSON — шлём как есть
                    full += payload;
                    send('token', payload);
                  }
                }
              }
            }
            if (full) { await done({ model: MODEL }); return; }
          } else {
            // fallback: модель вернула не стрим
            const text = (result && (result.response || result.result)) || (typeof result === 'string' ? result : '');
            if (text) {
              full = String(text);
              send('token', full);
              await done({ model: MODEL, fallback: true });
              return;
            }
          }
        } catch (err) {
          lastErr = (err && err.message) || String(err);
        }
      }
      send('error', 'Workers AI error: ' + lastErr);
      closed = true;
      try { controller.close(); } catch (e) {}
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

async function handleJson(env, messages, userKey, memory) {
  let lastErr = '';
  for (const MODEL of MODELS) {
    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: 512 });
      const reply =
        (result && (result.response || result.result)) ||
        (typeof result === 'string' ? result : '');
      if (reply) {
        if (userKey && memory) {
          memory.updatedAt = Date.now();
          await writeMemory(env, userKey, memory);
          await saveUser(env, userKey, { memory });
        }
        return json({ reply: String(reply), model: MODEL });
      }
    } catch (err) {
      lastErr = (err && err.message) || String(err);
    }
  }
  return json({ reply: 'Workers AI error: ' + lastErr });
}

/* =========================================================
   Cron: пуш-напоминания в Telegram (нужны TELEGRAM_BOT_TOKEN + D1)
   ========================================================= */
async function tgSend(env, chatId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
  } catch (e) { /* ignore */ }
}

// связываем /start px_<tgUserId> с чатом пользователя (для будущих пушей)
async function cronLinkStarts(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.DB) return;
  let offset = 0;
  try {
    const meta = await env.DB.prepare('SELECT v FROM cron_meta WHERE k = ?').bind('tg_offset').first();
    if (meta && meta.v) offset = Number(meta.v) || 0;
  } catch (e) {}
  let updates = [];
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + (offset + 1) + '&timeout=0');
    const j = await r.json();
    updates = (j && j.result) || [];
  } catch (e) { return; }
  for (const u of updates) {
    const msg = u.message || u.channel_post || {};
    const text = String(msg.text || '');
    const dl = JSON.stringify(msg.deep_link_data || '');
    const m = /px_(\d+)/.exec(text) || /px_(\d+)/.exec(dl);
    if (m && env.DB) {
      const key = 'tg:' + m[1];
      try {
        await env.DB.prepare(
          `INSERT INTO users (user_key, push_chat, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(user_key) DO UPDATE SET push_chat = excluded.push_chat, updated_at = excluded.updated_at`
        ).bind(key, Number(msg.chat && msg.chat.id)).run();
      } catch (e) {}
      await tgSend(env, Number(msg.chat && msg.chat.id),
        'Готово! Теперь я раз в день напоминаю, как дела у Nova 💜 Загляни в комнату — она скучает.');
    }
    if (u.update_id > offset) offset = u.update_id;
  }
  if (offset > 0 && env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO cron_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
      ).bind('tg_offset', String(offset)).run();
    } catch (e) {}
  }
}

// дневное персональное напоминание по сохранённому состоянию
async function cronDailyDigest(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.DB) return;
  let rows = [];
  try {
    const r = await env.DB.prepare(
      'SELECT user_key, push_chat, state FROM users WHERE push_chat IS NOT NULL AND push_chat > 0 LIMIT 200'
    ).all();
    rows = r.results || [];
  } catch (e) { return; }
  for (const row of rows) {
    let st = null;
    try { st = row.state ? JSON.parse(row.state) : null; } catch (e) { st = null; }
    let line = 'Nova ждёт тебя в комнате 💜 Загляни — расскажу, как проходили сутки.';
    if (st && st.needs) {
      const n = st.needs;
      if (Number(n.fatigue) >= 60) line = 'Nova устала и хочет спать, но очень по тебе скучает 😴 Загляни и разбуди.';
      else if (Number(n.hunger) >= 55) line = 'Nova проголодалась 🍜 Закажи ей доставку в комнате.';
      else if (Number(n.thirst) >= 55) line = 'Nova хочет пить 🧋 Загляни в комнату.';
    }
    await tgSend(env, Number(row.push_chat), line);
  }
}

async function runCron(event, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB) return;
  await cronLinkStarts(env);
  await cronDailyDigest(env);
}

/* =========================================================
   Router
   ========================================================= */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') return new Response('pxax-ai ok', { headers: cors });
    if (request.method !== 'POST') return json({ reply: 'Only POST' }, { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'Bad JSON' });
    }

    const initData = request.headers.get('X-Telegram-Init-Data') || '';
    const tgKey = userKeyFromInitData(initData, env.TELEGRAM_BOT_TOKEN);
    const userKey = tgKey || ('ip:' + (request.headers.get('CF-Connecting-IP') || 'anon'));

    // --- быстрые action-роуты (без основного чата) ---
    switch (body.action) {
      case 'sync':
        return handleSync(env, body, userKey);
      case 'code':
        return handleCode(env, body);
      case 'dream':
        if (!env.AI) return json({ ok: false, error: 'нет binding AI' });
        return handleDream(env, body);
    }

    // --- обычный чат ---
    const message = String(body.message || '').slice(0, MAX_MESSAGE);
    if (!message) return bad('Пустое сообщение');
    if (!env.AI) {
      return bad('Нет binding AI: Settings → Bindings → Workers AI → имя AI');
    }

    // память: D1 (если есть) → KV → новая
    let memory;
    if (env.DB) {
      const row = await loadSave(env, userKey);
      memory = (row && row.memory) || (await readMemory(env, userKey)) || { facts: [], createdAt: Date.now() };
    } else {
      memory = (await readMemory(env, userKey)) || { facts: [], createdAt: Date.now() };
    }
    const newFacts = extractFacts(message);
    if (newFacts.length) {
      memory.facts = Array.from(new Set([...(memory.facts || []), ...newFacts])).slice(-12);
    }
    // периодическая LLM-консолидация (не критична, не роняет ответ)
    memory.turns = Number(memory.turns || 0) + 1;
    if (memory.turns % CONSOLIDATE_EVERY === 0) {
      try { await consolidateMemory(env, memory, body); } catch (e) {}
    }

    const messages = normalizeMessages(body, memory);

    if (wantsStream(request)) {
      return handleStream(request, env, messages, userKey, memory);
    }
    return handleJson(env, messages, userKey, memory);
  },

  async event(cronEvent, env) {
    await runCron(cronEvent, env);
  }
};
