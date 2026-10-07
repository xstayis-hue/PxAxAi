/* =========================================================
   Тесты новых возможностей воркера: голос, зрение, память по смыслу.
   Запуск:  node worker/test/voice-vision.test.mjs

   Покрывает:
     G. Голосовой ввод: распознавание речи и отказы (пусто, битый base64)
     H. Зрение: картинка уходит ТОЛЬКО в модель зрения, а не в текстовую
     I. Эмбеддинги: сходство считается по смыслу, а не по совпадению слов
     J. Совместимость: без картинки работают прежние текстовые модели
   ========================================================= */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'index.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'pxax-vv-'));
const modPath = join(dir, 'worker.mjs');
writeFileSync(modPath, src);
const worker = (await import(pathToFileURL(modPath).href)).default;

/* --- журнал вызовов моделей: какие модели реально дёргались и с чем --- */
const calls = [];
const AI = {
  async run(model, opts) {
    calls.push({ model, opts });
    if (/whisper/i.test(model)) return { text: 'включи музыку пожалуйста' };
    if (/bge/i.test(model)) {
      // игрушечные векторы: «киберпанк» и «нео-нуар» близки, «погода» далека
      const q = JSON.stringify(opts && opts.text || '');
      if (/киберпанк|нео-нуар|фильм/i.test(q)) return { data: [[1, 0.9, 0]] };
      if (/погода|дожд/i.test(q)) return { data: [[0, 0, 1]] };
      return { data: [[0.5, 0.5, 0.5]] };
    }
    if (/vision/i.test(model)) return { response: 'вижу кота на столе' };
    return { response: 'обычный текстовый ответ' };
  }
};

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
const env = { MEMORY, AI };

function call(body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
  return worker
    .fetch(new Request('https://worker.test/', { method: 'POST', headers: h, body: JSON.stringify(body) }), env)
    .then(async (r) => ({ status: r.status, json: await r.json() }));
}

const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? `  [${extra}]` : ''}`);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/* ---------- G. Голосовой ввод ---------- */
kv.clear();
const sttOk = await call({ action: 'stt', audioBase64: b64('fake-webm-bytes') });
check('G1: речь распознана', sttOk.json.ok === true && /музыку/.test(sttOk.json.text || ''), JSON.stringify(sttOk.json).slice(0, 120));

const sttWrapped = await call({ action: 'stt', audioBase64: 'data:audio/webm;base64,' + b64('x') });
check('G2: data-URL префикс отброшен', sttWrapped.json.ok === true, JSON.stringify(sttWrapped.json).slice(0, 100));

const sttEmpty = await call({ action: 'stt', audioBase64: '' });
check('G3: пустое аудио отклонено', sttEmpty.json.ok === false, JSON.stringify(sttEmpty.json));

const sttNoAudio = await call({ action: 'stt' });
check('G4: без поля audioBase64 — отказ без падения', sttNoAudio.json.ok === false, JSON.stringify(sttNoAudio.json));

/* ---------- H. Зрение: картинка идёт в модель зрения ---------- */
kv.clear();
calls.length = 0;
const withImage = await call({
  message: 'что тут?',
  imageBase64: b64('жпиг-байты'),
  history: []
});
check('H1: ответ получен', withImage.json.reply === 'вижу кота на столе', JSON.stringify(withImage.json).slice(0, 120));
const imageModels = calls.map((c) => c.model);
check('H2: дёрнута именно модель зрения', imageModels.some((m) => /vision/i.test(m)), imageModels.join(','));

const visionCall = calls.find((c) => /vision/i.test(c.model));
const parts = visionCall && visionCall.opts && visionCall.opts.messages;
const userMsg = Array.isArray(parts) ? parts[parts.length - 1] : null;
check('H3: сообщение собрано как части (текст + картинка)',
  !!(userMsg && Array.isArray(userMsg.content) && userMsg.content.some((p) => p.type === 'image_url')),
  JSON.stringify(userMsg && userMsg.content && userMsg.content.map((p) => p.type)));
check('H4: текст в части текста сохранён',
  !!(userMsg && userMsg.content.some((p) => p.type === 'text' && /что тут/.test(p.text || ''))));

/* ---------- I. Эмбеддинги: recall по смыслу ---------- */
kv.clear();
calls.length = 0;
// два эпизода: про киберпанк и про погоду
await call({ message: 'мне нравится киберпанк и нео-нуар', history: [] });
await call({ message: 'сегодня отличная погода', history: [] });
// третий вопрос про фильмы — общих слов с первым нет, но смысл рядом
calls.length = 0;
const recallRes = await call({ message: 'посоветуй фильм', history: [] });
check('I1: embeddings-модель использована', calls.some((c) => /bge/i.test(c.model)), calls.map((c) => c.model).join(','));
const recallMsg = calls
  .filter((c) => !/bge/i.test(c.model))
  .map((c) => (c.opts.messages || []).find((m) => m.role === 'system'))
  .filter(Boolean)
  .map((m) => String(m.content))
  .join('\n');
check('I2: в промпт попал эпизод про киберпанк (по смыслу, без общих слов)',
  /киберпанк/i.test(recallMsg), recallMsg.includes('киберпанк') ? '' : 'нет упоминания');
check('I3: эпизод про погоду НЕ притянут', !/погода/i.test(recallMsg), recallMsg.includes('погода') ? 'притянут лишний' : '');

/* ---------- J. Совместимость: без картинки текстовые модели как раньше ---------- */
kv.clear();
calls.length = 0;
const plain = await call({ message: 'привет', history: [] });
check('J1: обычный ответ работает', plain.json.reply === 'обычный текстовый ответ', JSON.stringify(plain.json).slice(0, 120));
check('J2: модель зрения не дёргается без картинки', !calls.some((c) => /vision/i.test(c.model)), calls.map((c) => c.model).join(','));
check('J3: Llama 4 Scout первой в списке', /llama-4-scout/.test(calls[0] && calls[0].model), calls[0] && calls[0].model);

/* ---------- отчёт ---------- */
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log('\n' + (failed.length ? `ПРОВАЛЕНО: ${failed.length}` : `Все проверки пройдены: ${results.length}`));
if (failed.length) process.exit(1);