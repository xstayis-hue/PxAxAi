# PXAX · Ai — Cloudflare Worker

LLM-бэкенд мини-аппа. Понимает состояние персонажа, стримит по SSE, может хранить память в Workers KV.

## Что нового относительно первой версии

1. **State-aware.** Принимает `body.state` (needs, credits, sleeping, roomStatus, timeOfDay, userName, language) и подмешивает это в system-промпт — ответы заземлены в жизнь персонажа.
2. **SSE-стриминг.** Если клиент шлёт `Accept: text/event-stream`, воркер стримит токены (`event: token`, `event: done`, `event: error`). Иначе — обычный JSON `{ reply, model }`, обратная совместимость сохранена.
3. **Действия и ссылки.** В system-промпт добавлен список `availableActions` и `links`; LLM может вернуть в конце ответа `{"action":"desk"}` или `{"link":"https://t.me/…"}` — клиент покажет inline-кнопку/выполнит действие в 3D.
4. **Память (опционально).** Если настроен KV-binding `MEMORY`, воркер запоминает факты о пользователе («меня зовут…», «мне … лет», «я люблю…», «я из…») и подставляет их в следующие ответы. Ключ — `tg:<user_id>` из `X-Telegram-Init-Data`, иначе `ip:<CF-Connecting-IP>`. TTL — 30 дней.
5. **D1-saves и промокоды (опционально).** Если настроен D1-binding `DB` (таблицы `users`, `cron_meta`, `codes` из `schema.sql`), доступны новые `action`:
   - `sync` (`op: push|pull`) — кросс-девайсное состояние (xp, ◈, needs, wardrobe, counters) с антисбот-лимитами на сервере;
   - `code` — одноразовые промокоды (`PXAX-BETPAY`, `PXAX-PREDICT`, `PXAX-VPH`, `PXAX-NOW`);
   - `dream` — короткая LLM-сценка-сон из событий дня.
   Без D1 эти `action` отвечают вежливыми ошибками, остальное работает как раньше.
6. **Проверка initData.** Если задан `TELEGRAM_BOT_TOKEN`, `X-Telegram-Init-Data` проверяется по HMAC-SHA256 (и по возрасту ≤ 24ч), иначе — fallback на regex `id`.
7. **Cron-пуш в Telegram.** `event`-хук (cron `0 7 * * *`) связывает `/start px_<userId>` с чатом и раз в день шлёт персональное напоминание по сохранённому состоянию. Нужны `TELEGRAM_BOT_TOKEN` + D1.
8. **LLM-консолидация памяти.** Раз в 12 реплик компактная модель переписывает список фактов (убирает одноразовое, держит ≤ 12 пунктов).

## Деплой

```bash
cd worker
# 1) залогиниться
npx wrangler login
# 2) (опционально) создать KV для памяти
npx wrangler kv namespace create MEMORY
#    вставь полученный id в wrangler.toml в блок [[kv_namespaces]]
# 3) задеплоить
npx wrangler deploy
```

После деплоя URL воркера должен совпадать с `CFG.AI_API_URL` в `index.html` (сейчас `https://pxaxai.xstayis.workers.dev`).

## Проверка

```bash
# обычный JSON (старая схема)
curl -X POST https://pxaxai.xstayis.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"привет","history":[]}'

# со стейтом
curl -X POST https://pxaxai.xstayis.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message":"как ты?","state":{"needs":{"hunger":80,"fatigue":65},"roomStatus":"Лежит на кровати","timeOfDay":"ночь","userName":"Саша"}}'

# SSE-стриминг
curl -N -X POST https://pxaxai.xstayis.workers.dev \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"расскажи факт"}'
```

## Формат ответа со стримингом

```
event: token
data: Привет

event: token
data: !

event: done
data: {"model":"@cf/meta/llama-3.2-3b-instruct"}
```

Клиент автоматически падает обратно на JSON, если сервер не отвечает `text/event-stream`.
