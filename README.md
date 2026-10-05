# PXAX · Nova — 3D AI-компаньон (Telegram Mini App)

Живой нейро-агент в 3D-комнате: разговаривает через LLM, живёт по тамагочи-ритму (голод, жажда, усталость, туалет), зарабатывает кристаллы ◈ в мини-играх, тратит их на еду и уход. Хаб экосистемы PXAX: из приложения открываются боты прогнозов, VPN и монеты.

**Демо (GitHub Pages):** https://xstayis-hue.github.io/PxAxAi/
**Telegram-бот для привязки:** `@PxAxAi_bot`

![platform](https://img.shields.io/badge/telegram-mini%20app-blue) ![three](https://img.shields.io/badge/three.js-0.166-black) ![worker](https://img.shields.io/badge/cloudflare-worker-orange) ![license](https://img.shields.io/badge/license-MIT-green)

---

## Что умеет (v0.4)

- 🛏️ **3D-комната** (Three.js 0.166, без сборки): процедурная кибер-комната, риггед-персонаж из нескольких glTF-частей с ретаргетингом скелета, A*-навигация к кровати/ноутбуку/двери, анимации ходьбы/сидения/лежания, липсинк при ответах.
- 📸 **Фото-студия:** кнопка 📸 снимает текущий кадр 3D-комнаты (WebGL `toDataURL`) и даёт «Поделиться / Скачать» (Web Share API → clipboard → скачивание).
- 💬 **Чат с LLM** через Cloudflare Worker: **state-aware** — воркер получает голод/жажду/усталость, занятие, время суток, уровень и настроение и отвечает, заземляясь на это.
- 🗣️ **Команды на естественном языке:** «иди к ноутбуку», «ложись спать», «чем занята?», «покорми», «в туалет» — мгновенно и офлайн (локальный парсер), плюс LLM сама возвращает `{"action":"desk"}` / `{"link":"…"}` — inline-кнопка или действие в 3D.
- 🌊 **Стриминг ответов (SSE):** токены в реальном времени, кнопка **Stop** (AbortController), автооткат на JSON.
- 🍜 **Тамагочи (Nova «сильнее человека»):** потребности копятся заметно медленнее, чем у человека; при усталости 70%+ спит 5–30 минут, в туалет 2–5 минут, еда за ◈ с доставкой за 30 секунд.
- ✨ **Редкие события:** раз в ~45 минут в комнате случается «призрак глюка / метеор / добрый сигнал / подарок» — мелкие ◈ и атмосфера, не чаще 3 в день.
- 🌙 **Сны:** после пробуждения Nova рассказывает короткий LLM-сон, собранный из реальных событий её дня (диалоги, еда, игры, редкие события).
- ☁️ **Кросс-девайс облако (D1):** уровень, ◈, потребности, гардероб и квесты синхронизируются между устройствами через worker (push дёбоксерится, pull при загрузке, антисбот-лимиты на сервере). Локальный `localStorage` остаётся офлайн-кэшем.
- 🎟️ **Промокоды:** вкладки «Промокод» в уходе принимают одноразовые коды экосистемы (PXAX-BETPAY, PXAX-PREDICT, PXAX-VPH, PXAX-NOW) → ◈.
- 🔔 **Напоминания в Telegram:** deep-link `?start=px_<userId>` подписывает пользователя на персональное пуш-сообщение раз в день (cron worker по сохранённому состоянию).
- 🧠 **Память пользователя:** KV + D1, регуллярная LLM-консолидация фактов (compact-модель, раз в 12 реплик) вместо только-regex.
- 🎯 **Дейли-квесты и стрик** + 🎮 **миниигры** («Перехвати сигнал», «Data Run») с заработком ◈ и кулдауном 30 минут.
- 📱 **Telegram-интеграция:** WebApp SDK, хаптика, тема; `X-Telegram-Init-Data` проверяется по HMAC (если задан `TELEGRAM_BOT_TOKEN`).
- ♿ **PWA + accessibility:** manifest, service worker, `prefers-reduced-motion`, пауза фоновых анимаций при скрытой вкладке.

## Структура

```
index.html           — приложение одним файлом (UI, чат, тамагочи, экономика)
scene3d.js           — 3D-сцена: комната, персонаж, анимации, навигация (ES-модуль)
js/
  api.js             — сетевой слой: JSON + SSE-стрим + AbortController
  agent-actions.js   — парсер команд на естественном языке → действия комнаты
  perf.js            — reduced-motion, пауза при скрытой вкладке
  quests.js          — дейли-квесты, стрик
assets/
  avatar-nova.svg      — аватар в чате
  scene3d/           — модели персонажа и библиотека анимаций (glb)
worker/
  index.js           — Cloudflare Worker: state-aware LLM, SSE, KV-память
  wrangler.toml      — конфиг деплоя
manifest.webmanifest — PWA-манифест
sw.js                — service worker (статика в кэш, API в сеть)
```

Модели и анимации — [Quaternius](https://quaternius.com) (Universal Base Characters / Modular Outfits / Universal Animation Library), лицензия **CC0 1.0** (см. `assets/scene3d/LICENSE.md`).

## Запуск локально

Нужен любой статический сервер (ES-модули не работают с `file://`):

```bash
npx serve .          # или: python -m http.server 8000
```

Открой `http://localhost:8000`. Конфиг — объект `CFG` в начале скрипта в `index.html`:

```js
AI_API_URL: 'https://pxaxai.xstayis.workers.dev', // LLM-бэкенд (Cloudflare Worker)
PREDICTIONS_LINK / VPN_LINK / COIN_LINK,           // боты экосистемы
HISTORY_MAX / CONTEXT_LEN,                         // память диалога (localStorage)
```

## Воркер (LLM-бэкенд)

Код — в [`worker/`](worker/). Ключевое:

- принимает `{ message, history, state, availableActions, links }`;
- если есть `Accept: text/event-stream` — стримит токены (SSE);
- маршрутизация по `action`: `sync` (push/pull saves в D1), `code` (промокоды), `dream` (сцены-сны);
- если настроен KV-binding `MEMORY` / D1 `DB` — запоминает факты о пользователе (LLM-консолидация раз в 12 реплик) и состояние между устройствами;
- `X-Telegram-Init-Data` проверяется по HMAC-SHA256, если задан `TELEGRAM_BOT_TOKEN`;
- cron (`0 7 * * *`) отправляет персональное пуш-напоминание в Telegram пользователям, подписавшимся через `?start=px_<userId>`;
- иначе полностью обратно совместим со старым клиентом (`{ reply, model }`).

### Деплой D1 (облако + промокоды + пуши)

D1 опционален: без него всё работает как раньше (KV-память, без синка и промокодов).

```bash
cd worker
npx wrangler d1 create pxaxai                 # появится database_id
# вставь database_id в wrangler.toml (секция [[d1_databases]], снимает #)
npx wrangler d1 migrations apply pxaxai       # или примени schema.sql через `wrangler d1 execute`
npx wrangler deploy
# опционально: SECRET через Dashboard → Settings → Secrets: TELEGRAM_BOT_TOKEN
```

Схема — `worker/schema.sql` (таблицы `users`, `cron_meta`, `codes` + стартовые промокоды).

## Дорожная карта

- [x] State-aware LLM (needs, roomStatus, timeOfDay, level, mood → system-промпт)
- [x] SSE-стриминг + кнопка Stop
- [x] Команды чат ↔ 3D (локальный парсер + JSON-action от LLM)
- [x] Дейли-квесты и стрик
- [x] PWA: manifest, service worker, reduced-motion, пауза фоновых циклов
- [x] Кросс-девайсное состояние через D1 (push/pull, антисбот-лимиты)
- [x] Фото-студия (снимок 3D-комнаты: share / скачать)
- [x] Редкие события + LLM-сны из событий дня
- [x] Промокоды экосистемы (D1, одноразовые)
- [x] Telegram-пуш напоминания (cron + deep-link)
- [x] LLM-консолидация памяти пользователя
- [ ] Гардероб/косметика за ◈ (ретаргетинг аутфитов уже работает, `Superhero_Female.glb` в ассетах)
- [ ] TTS-озвучка, голосовой ввод
- [ ] Draco/meshopt + KTX2 (~6 МБ glb на первый вход)
- [ ] Больше мини-игр, i18n

## Лицензия

MIT (см. [LICENSE](LICENSE)). 3D-модели Quaternius — CC0 1.0.
