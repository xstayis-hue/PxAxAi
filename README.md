# PXAX · Nova — 3D AI-компаньон (Telegram Mini App)

Живой нейро-агент в 3D-комнате: разговаривает через LLM, живёт по тамагочи-ритму (голод, жажда, усталость, туалет), зарабатывает кристаллы ◈ в мини-играх, тратит их на еду и уход. Хаб экосистемы PXAX: из приложения открываются боты прогнозов, VPN и монеты.

**Демо (GitHub Pages):** https://xstayis-hue.github.io/PxAxAi/
**Telegram-бот для привязки:** `@PxAxAi_bot`

![platform](https://img.shields.io/badge/telegram-mini%20app-blue) ![three](https://img.shields.io/badge/three.js-0.166-black) ![worker](https://img.shields.io/badge/cloudflare-worker-orange) ![license](https://img.shields.io/badge/license-MIT-green)

---

## Что умеет (v0.3)

- 🛏️ **3D-комната** (Three.js 0.166, без сборки): процедурная кибер-комната, риггед-персонаж из нескольких glTF-частей с ретаргетингом скелета, A*-навигация к кровати/ноутбуку/двери, анимации ходьбы/сидения/лежания, липсинк при ответах.
- 💬 **Чат с LLM** через Cloudflare Worker: теперь **state-aware** — воркер получает голод/жажду/усталость, занятие, время суток и имя пользователя и отвечает, заземляясь на это.
- 🗣️ **Команды на естественном языке:** «иди к ноутбуку», «ложись спать», «чем занята?», «покорми», «в туалет» — работают мгновенно и даже офлайн (локальный парсер), плюс LLM может сама вернуть `{"action":"desk"}` / `{"link":"…"}` — клиент покажет inline-кнопку или выполнит действие в 3D.
- 🌊 **Стриминг ответов (SSE):** если воркер отдаёт `text/event-stream`, текст печатается токенами в реальном времени; есть кнопка **Stop** (отмена через AbortController). Автоматический откат на обычный JSON.
- 🍜 **Тамагочи:** потребности растут в реальном времени; при усталости 70%+ Ai ложится спать (чат закрывается), в туалет отлучается на 2–5 минут, еда заказывается за ◈ с доставкой через 30 секунд.
- 🎯 **Дейли-квесты и стрик:** «Поговори 3 сообщения», «Покорми», «Выиграй 3+ раунда во взломе», «Открой уход» — награды ◈, счётчик дней подряд 🔥.
- 🎮 **Мини-игра** «Перехвати сигнал»: 5 раундов, заработок ◈.
- 📱 **Telegram-интеграция:** WebApp SDK, хаптика, тема, `X-Telegram-Init-Data` на воркер для кросс-девайсной памяти (если включена KV).
- ♿ **PWA + accessibility:** manifest, service worker (кэш статики, API — в обход), `prefers-reduced-motion`, пауза фоновых анимаций при скрытой вкладке, theme-color, description.

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
- если настроен KV-binding `MEMORY` — запоминает факты о пользователе между сессиями (30 дней TTL), ключ — Telegram user id;
- иначе полностью обратно совместим со старым клиентом (`{ reply, model }`).

Деплой: `cd worker && npx wrangler deploy`. Подробности — в [worker/README.md](worker/README.md).

## Дорожная карта

- [x] State-aware LLM (needs, roomStatus, timeOfDay → system-промпт)
- [x] SSE-стриминг + кнопка Stop
- [x] Команды чат ↔ 3D (локальный парсер + JSON-action от LLM)
- [x] Дейли-квесты и стрик
- [x] PWA: manifest, service worker, reduced-motion, пауза фоновых циклов
- [ ] Кросс-девайсное состояние тамагочи и истории чата через KV/D1 (клиент уже шлёт `X-Telegram-Init-Data`)
- [ ] Гардероб/косметика за ◈ (ретаргетинг аутфитов уже работает, `Superhero_Female.glb` в ассетах)
- [ ] TTS-озвучка, голосовой ввод
- [ ] Draco/meshopt + KTX2 (~6 МБ glb на первый вход)
- [ ] Больше мини-игр, редкие события, i18n

## Лицензия

MIT (см. [LICENSE](LICENSE)). 3D-модели Quaternius — CC0 1.0.
