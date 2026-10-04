/* =========================================================
   PXAX · Nova — Cloudflare Worker
   - понимает состояние персонажа (needs, roomStatus, timeOfDay)
   - SSE-стриминг, если клиент принимает (Accept: text/event-stream)
   - опциональная память через Workers KV (binding MEMORY)
   - graceful fallback на старый формат { message, history }
   ========================================================= */

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
  const lines = [
    'Ты — Nova, живой нейро-компаньон (девушка-ИИ) в 3D-комнате Telegram Mini App.',
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
        }
        return json({ reply: String(reply), model: MODEL });
      }
    } catch (err) {
      lastErr = (err && err.message) || String(err);
    }
  }
  return json({ reply: 'Workers AI error: ' + lastErr });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') return new Response('pxax-ai ok', { headers: cors });
    if (request.method !== 'POST') return json({ reply: 'Only POST' }, { status: 405 });

    if (!env.AI) {
      return bad('Нет binding AI: Settings → Bindings → Workers AI → имя AI');
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return bad('Bad JSON');
    }
    const message = String(body.message || '').slice(0, MAX_MESSAGE);
    if (!message) return bad('Пустое сообщение');

    // идентификация: Telegram initData → user id; иначе анонимный ключ по IP
    let userKey = null;
    const initData = request.headers.get('X-Telegram-Init-Data') || '';
    const tgUserMatch = /"id"\s*:\s*(\d+)/.exec(initData);
    if (tgUserMatch) userKey = 'tg:' + tgUserMatch[1];
    else {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      userKey = 'ip:' + ip;
    }

    const memory = (await readMemory(env, userKey)) || { facts: [], createdAt: Date.now() };
    // накапливаем факты из сообщения
    const newFacts = extractFacts(message);
    if (newFacts.length) {
      memory.facts = Array.from(new Set([...(memory.facts || []), ...newFacts])).slice(-12);
    }

    const messages = normalizeMessages(body, memory);

    if (wantsStream(request)) {
      return handleStream(request, env, messages, userKey, memory);
    }
    return handleJson(env, messages, userKey, memory);
  },
};
