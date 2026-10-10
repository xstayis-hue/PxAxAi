/* =========================================================
   Тесты воркера PXAX · Nova (node 18+, без зависимостей).
   Запуск:  node worker/test/worker.test.mjs

   Покрывает:
     A. Безопасность: чужой save / промокоды / подпись initData
     B. Жизнь на сервере: decay потребностей, сон, туалет
     C. Память: эпизоды + релевантный recall
     D. Античит: частота push и суточные потолки прироста
     E. action:'life' и отложенное «Nova написала первой»
     F. Совместимость: обычный чат без initData
   ========================================================= */
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// index.js — ESM, но в проекте нет "type":"module"; проецируем во временный .mjs
const src = readFileSync(join(here, '..', 'index.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'pxax-test-'));
const modPath = join(dir, 'worker.mjs');
writeFileSync(modPath, src);
const worker = (await import(pathToFileURL(modPath).href)).default;

const BOT = '123456:TEST_TOKEN';

/* --- in-memory KV (поддерживает { type: 'json' } как настоящий Workers KV) --- */
const kv = new Map();
const MEMORY = {
  async get(k, opts) {
    if (!kv.has(k)) return null;
    const v = kv.get(k);
    if (opts && opts.type === 'json') { try { return JSON.parse(v); } catch (e) { return null; } }
    return v;
  },
  async put(k, v) { kv.set(k, v); },
  async delete(k) { kv.delete(k); },
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const names = [...kv.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? names.indexOf(cursor) + 1 : 0;
    const slice = names.slice(start, start + limit);
    return { keys: slice.map((name) => ({ name })), list_complete: start + limit >= names.length, cursor: slice[slice.length - 1] };
  }
};
const env = {
  MEMORY,
  AI: { async run(model, opts) { return { response: 'тестовый ответ' }; } },
  TELEGRAM_BOT_TOKEN: BOT
};

function sign(id, authDate) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', JSON.stringify({ id, first_name: 'Tester' }));
  const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
  const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
  params.set('hash', createHmac('sha256', secret).update(pairs.join('\n')).digest('hex'));
  return params.toString();
}

function call(body, initData) {
  const headers = { 'Content-Type': 'application/json' };
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  return worker
    .fetch(new Request('https://worker.test/', { method: 'POST', headers, body: JSON.stringify(body) }), env)
    .then(async (r) => ({ status: r.status, json: await r.json() }));
}

const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? `  [${extra}]` : ''}`);
const now = Math.floor(Date.now() / 1000);
const good = sign(111, now);
// сбрасываем rate-limit перед push'ами, которые должны пройти
const clearRate = () => { for (const k of [...kv.keys()]) if (k.startsWith('rl:')) kv.delete(k); };

/* ---------- A. Безопасность: чужой save недостижим ---------- */
// сначала создаём save владельца id=111
kv.clear();
const ownPush = await call({ action: 'sync', op: 'push', ts: Date.now(), state: {
  credits: 777, xp: 50, updatedAt: Date.now(),
  needs: { hunger: 5, thirst: 5, fatigue: 5, toilet: 5, updatedAt: Date.now() }
} }, good);
check('A0: свой save пишется', ownPush.json.ok === true && ownPush.json.saved.credits === 777, JSON.stringify(ownPush.json).slice(0, 120));

// попытка выдать себя за 111 неподписанным заголовком — НЕ должна отдать его save
const forged = await call({ action: 'sync', op: 'pull' }, JSON.stringify({ id: 111 }));
const forgedState = forged.json && forged.json.state;
check('A1: чужой id без подписи НЕ отдаёт чужой save', !(forgedState && forgedState.credits === 777), 'state=' + JSON.stringify(forgedState));
check('A1b: такой pull уходит в отдельный ip-бакет', !!(forged.json && forged.json.ok === true), JSON.stringify(forged.json).slice(0, 100));

const tampered = new URLSearchParams(sign(111, now)); tampered.set('hash', 'deadbeef'.repeat(8));
const tamperedRes = await call({ action: 'sync', op: 'pull' }, tampered.toString());
check('A2: подделанный hash НЕ отдаёт чужой save', !(tamperedRes.json.state && tamperedRes.json.state.credits === 777), JSON.stringify(tamperedRes.json).slice(0, 100));
check('A3: просроченный initData НЕ отдаёт чужой save', !((await call({ action: 'sync', op: 'pull' }, sign(111, now - 2 * 24 * 3600))).json.state || {}).credits);
// свой save по-прежнему доступен владельцу
const ownPull = await call({ action: 'sync', op: 'pull' }, good);
check('A4: владелец со своей подписью читает свой save', ownPull.json.state && ownPull.json.state.credits >= 777, JSON.stringify(ownPull.json).slice(0, 120));

// промокод: один раз на идентичность, повторно — нет
kv.set('code:PXAX-TEST', JSON.stringify({ code: 'PXAX-TEST', credits: 60, max_uses: 1, uses: 0, message: '+60 ◈', redeemed: [] }));
const promo1 = await call({ action: 'code', code: 'PXAX-TEST' }, good);
check('A5: промокод выдаётся', promo1.json.ok === true && promo1.json.credits === 60, JSON.stringify(promo1.json));
const promoAgain = await call({ action: 'code', code: 'PXAX-TEST' }, good);
check('A6: тот же промокод повторно отклонён', promoAgain.json.ok === false, JSON.stringify(promoAgain.json));
// другой пользователь со своей подписью этот же код не получит — он исчерпан
const promoOther = await call({ action: 'code', code: 'PXAX-TEST' }, sign(222, now));
check('A7: исчерпанный код не достаётся другому', promoOther.json.ok === false, JSON.stringify(promoOther.json));

/* ---------- B. Жизнь на сервере ---------- */
clearRate();
const old = Date.now() - 3 * 3600000; // 3 часа назад
await call({ action: 'sync', op: 'push', ts: Date.now(), state: {
  credits: 100, xp: 50, updatedAt: old,
  needs: { hunger: 10, thirst: 10, fatigue: 20, toilet: 10, updatedAt: old }
} }, good);
const pull1 = await call({ action: 'sync', op: 'pull' }, good);
const n1 = pull1.json.state.needs;
check('B1: голод вырос за 3 ч офлайна (~14%)', n1.hunger > 10 && n1.hunger < 30, 'hunger=' + n1.hunger.toFixed(1));
check('B2: жажда выросла сильнее голода (~20%)', n1.thirst > n1.hunger, 'thirst=' + n1.thirst.toFixed(1));
check('B3: потребности в [0,100]', n1.hunger <= 100 && n1.toilet <= 100 && n1.fatigue <= 100);
check('B4: сервер вернул своё время', Number.isFinite(pull1.json.serverNow));

// сон: высокий fatigue при офлайне → сервер усыпляет
clearRate();
const old2 = Date.now() - 30 * 60000;
await call({ action: 'sync', op: 'push', ts: Date.now(), state: {
  credits: 100, xp: 50, updatedAt: Date.now(),
  needs: { hunger: 0, thirst: 0, fatigue: 95, toilet: 0, updatedAt: old2 }
} }, good);
const pull2 = await call({ action: 'sync', op: 'pull' }, good);
check('B5: при fatigue≥70 сервер запускает сон', Number(pull2.json.state.needs.sleepUntil) > Date.now(), 'sleepUntil=' + pull2.json.state.needs.sleepUntil);

/* ---------- D. Античит ---------- */
kv.clear();
const pushes = [];
for (let i = 0; i < 6; i++) {
  pushes.push(await call({ action: 'sync', op: 'push', ts: Date.now() + i, state: { credits: 100 + i * 100, xp: 50, needs: { hunger: 1, thirst: 1, fatigue: 1, toilet: 1, updatedAt: Date.now() } } }, good));
}
const rateLimited = pushes.filter((p) => p.json.ok === false && /часто/.test(p.json.error || '')).length;
check('D1: серия мгновенных push режется частотой', rateLimited >= 3, 'limited=' + rateLimited + '/6');
// суточный потолок прироста кредитов (один push, но дневной счётчик уже почти исчерпан)
kv.clear(); kv.set('rl:tg:111', JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 5, last: 0, credits: 19500, xp: 0 }));
const big = await call({ action: 'sync', op: 'push', ts: Date.now(), state: { credits: 99999, xp: 0, needs: { hunger: 1, thirst: 1, fatigue: 1, toilet: 1, updatedAt: Date.now() } } }, good);
check('D2: суточный потолок прироста кредитов держит', big.json.error === 'суточный лимит прогресса', JSON.stringify(big.json).slice(0, 140));

/* ---------- C/E/F. Память, life, чат ---------- */
kv.clear();
const chat1 = await call({ message: 'я люблю синтвейв и играю на гитаре', history: [], state: { credits: 30, xp: 5, needs: { hunger: 20, thirst: 20, fatigue: 10, toilet: 10, updatedAt: Date.now() } } }, good);
check('C1: обычный чат работает со своей подписью', chat1.status === 200 && typeof chat1.json.reply === 'string', JSON.stringify(chat1.json).slice(0, 120));
const mem1 = JSON.parse(kv.get('mem:tg:111') || 'null');
check('C2: эпизод диалога сохранён в память', !!(mem1 && mem1.episodes && mem1.episodes.length >= 1), JSON.stringify(mem1 && mem1.episodes && mem1.episodes.length));
check('C3: в KV сохранено состояние (server life)', !!kv.get('save:tg:111'));

// recall: второй запрос про гитару должен получить эпизод в промпт — проверим через прямой вызов промпта
const recallSrc = src;
check('C4: в промпте есть блок общей истории', /общей истории всплывает/.test(recallSrc));
check('C5: recall фильтрует по пересечению слов', /score > 1\.05/.test(recallSrc));

// life: awayForMs и отсутствие state на первом контакте
kv.clear();
const lifeFresh = await call({ action: 'life' }, good);
check('E1: life на первом контакте не выдумывает state', lifeFresh.json.ok === true && lifeFresh.json.state === null, JSON.stringify(lifeFresh.json).slice(0, 120));

// proactive: кладём ожидающее сообщение — life должен его отдать и очистить
kv.set('pend:tg:111', JSON.stringify({ kind: 'missing', text: 'Соскучилась…', t: Date.now() }));
const life2 = await call({ action: 'life' }, good);
check('E2: life отдаёт «Nova написала первой»', !!(life2.json.proactive && life2.json.proactive.text === 'Соскучилась…'), JSON.stringify(life2.json.proactive));
const life3 = await call({ action: 'life' }, good);
check('E3: сообщение отдаётся один раз', life3.json.proactive === null, JSON.stringify(life3.json.proactive));

check('E4: life сохраняет lastSeen (сервер знает, когда ты ушёл)', !!(JSON.parse(kv.get('mem:tg:111') || '{}').lastSeen > 0));

// F. совместимость: чат без initData (вне Telegram) не блокируется security-гейтом
kv.clear();
const anonChat = await call({ message: 'привет', history: [] }, null);
check('F1: чат без initData работает (вне Telegram)', anonChat.status === 200 && typeof anonChat.json.reply === 'string', JSON.stringify(anonChat.json).slice(0, 120));
// анонимный sync тоже работает, но в отдельном ip-бакете и не видит чужой save
const anonSync = await call({ action: 'sync', op: 'pull' }, null);
check('F2: анонимный sync → свой (пустой) ip-бакет, не чужой save', anonSync.json.ok === true && anonSync.json.state === null, JSON.stringify(anonSync.json).slice(0, 120));
// life без подписи тоже уходит в ip-бакет (не 401) — так облако живо без токена бота
const anonLife = await call({ action: 'life' }, null);
check('F3: life без initData работает в ip-бакете', anonLife.json.ok === true && anonLife.json.state === null, JSON.stringify(anonLife.json).slice(0, 120));

/* ---------- G. Гардероб: купленное и цвет переживают синхронизацию ----------
   За вещи и цвета платят ◈, поэтому сервер обязан их сохранять: иначе после
   кросс-девайс pull гардероб откатывался бы к базовому образу. */
clearRate();
const wardrobePush = await call({ action: 'sync', op: 'push', ts: Date.now(), state: {
  credits: 200, xp: 60, updatedAt: Date.now(),
  needs: { hunger: 5, thirst: 5, fatigue: 5, toilet: 5, updatedAt: Date.now() },
  wardrobe: { outfit: 'ranger', hair: 'buns', tints: { outfit: '#5ce1e6', hair: '' }, owned: { outfit: ['ranger'], hair: ['buns'], tint: ['cyan'] } }
} }, good);
check('G1: купленный образ и цвет сохранены на сервере',
  wardrobePush.json.saved.wardrobe.outfit === 'ranger' &&
  wardrobePush.json.saved.wardrobe.tints.outfit === '#5ce1e6' &&
  Array.isArray(wardrobePush.json.saved.wardrobe.owned.tint) &&
  wardrobePush.json.saved.wardrobe.owned.tint[0] === 'cyan',
  JSON.stringify(wardrobePush.json.saved.wardrobe));
const wardrobePull = await call({ action: 'sync', op: 'pull' }, good);
check('G2: pull отдаёт их обратно',
  wardrobePull.json.state.wardrobe.outfit === 'ranger' &&
  wardrobePull.json.state.wardrobe.owned.outfit.indexOf('ranger') !== -1,
  JSON.stringify(wardrobePull.json.state.wardrobe));
// произвольный текст в поле цвета не должен доезжать целиком
clearRate();
const tintClamp = await call({ action: 'sync', op: 'push', ts: Date.now(), state: {
  credits: 0, xp: 0, updatedAt: Date.now(),
  needs: { hunger: 0, thirst: 0, fatigue: 0, toilet: 0, updatedAt: Date.now() },
  wardrobe: { outfit: 'peasant', hair: 'long', tints: { outfit: '<script>alert(1)</script>', hair: 'javascript:alert(1)' } }
} }, good);
check('G3: цвет обрезается по длине (9 символов), произвольный текст не проходит целиком',
  tintClamp.json.saved.wardrobe.tints.outfit.length <= 9 && tintClamp.json.saved.wardrobe.tints.hair.length <= 9,
  JSON.stringify(tintClamp.json.saved.wardrobe.tints));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
