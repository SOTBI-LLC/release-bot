# releasebot

Telegram-бот для управления релизами: принимает уведомления о сборке образа из CI, публикует сообщение в чат с кнопкой **release**, а по нажатию запускает GitHub Actions workflow (`workflow_dispatch`) в окружениях **dev** и **prod**.

Развёрнут как [Cloudflare Worker](https://developers.cloudflare.com/workers/) — без контейнеров и постоянного HTTP-сервера.

## TL;DR — ключевые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Telegram SDK | **grammY** | официально поддерживает Cloudflare Workers (fetch-based), активно поддерживается |
| HTTP-роутинг | **Hono** | де-факто стандарт для Workers, ~13 KB, Web-стандартные API |
| Состояние релизов | **Durable Object (SQLite backend)** | строгая консистентность между созданием релиза и нажатием кнопки; доступен и на Free-плане |
| Получение апдейтов | **только webhook** | в Workers нет персистентного процесса для long polling |
| Валидация | **zod** | компактная, типобезопасная схема входящих данных |
| Конфигурация | `wrangler.jsonc` + `wrangler secret put` | vars в репозитории, секреты — через CLI |

---

## Как это работает

```
CI (GitHub Actions)                    Cloudflare Worker                    Telegram / GitHub
──────────────────                     ─────────────────                    ─────────────────

POST /build-notifications  ──────►  валидация + shared secret
  (X-Releasebot-Secret)             сохранение контекста в DO
                                    sendMessage в TELEGRAM_CHAT_ID
                                    с кнопкой [release]
                                              │
                                              ▼
                                    POST /telegram/webhook  ◄────  callback_query
                                              │
                         пользователь жмёт release → dev / prod
                                              │
                                              ▼
                                    workflow_dispatch  ──────────►  GitHub Actions
                                    (restart.yaml)
```

1. CI отправляет JSON с метаданными сборки на `POST /build-notifications`.
2. Worker сохраняет контекст релиза в Durable Object и публикует сообщение в Telegram.
3. Разрешённый пользователь нажимает **release** → выбирает **dev** или **prod**.
4. Worker вызывает `workflow_dispatch` в целевом репозитории с `tag` и `environment`.
5. Клавиатура обновляется: выполненное окружение помечается галочкой.

Контекст релиза живёт **24 часа**, затем удаляется alarm-ом Durable Object.

---

## Стек

| Компонент | Библиотека / сервис |
|---|---|
| Runtime | Cloudflare Workers |
| HTTP | Hono 4 |
| Telegram Bot API | grammY 1 |
| Валидация | zod 4 |
| Хранилище | Durable Object `ReleaseStore` |
| Тесты | Vitest + `@cloudflare/vitest-pool-workers` |
| CI/CD | GitHub Actions → `cloudflare/wrangler-action` |

---

## Структура проекта

```
releasebot/
├── src/
│   ├── index.ts                 # Hono app: HTTP-роуты + export Durable Object
│   ├── env.ts                   # типы Env (биндинги и секреты)
│   ├── security.ts              # timing-safe сравнение shared secret
│   ├── domain/
│   │   ├── notification.ts      # zod-схема BuildNotification
│   │   └── callback.ts          # parseCallbackData (release:/deploy:/noop)
│   ├── storage/
│   │   ├── releaseStore.ts      # Durable Object класс
│   │   └── client.ts            # getReleaseStore(env) helper
│   ├── telegram/
│   │   ├── bot.ts               # grammY Bot + обработка callback_query
│   │   └── view.ts              # клавиатуры и рендер сообщения
│   └── github/
│       └── client.ts            # dispatchWorkflow
├── test/
│   ├── handlers.test.ts
│   └── index.spec.ts
├── wrangler.jsonc
├── .dev.vars                    # локальные секреты (в .gitignore)
├── package.json
└── vitest.config.ts
```

---

## HTTP API

### `GET /healthz`

Проверка живости. Ответ: `204 No Content`.

### `POST /build-notifications`

Принимает уведомление о сборке и публикует сообщение в Telegram.

**Заголовки**

| Заголовок | Обязателен | Описание |
|---|---|---|
| `Content-Type` | да | `application/json` |
| `X-Releasebot-Secret` | да | Shared secret (`RELEASEBOT_SHARED_SECRET`) |

**Тело запроса**

| Поле | Тип | Обязателен | Описание |
|---|---|---|---|
| `repository` | string | да | `owner/name` репозитория |
| `ref` | string | да | Git ref для `workflow_dispatch` |
| `branch` | string | нет | Ветка (для отображения; fallback — `ref`) |
| `sha` | string | нет | SHA коммита (ссылка в сообщении) |
| `tag` | string | да | Тег образа, передаётся в workflow |
| `actor` | string | да | Кто запустил сборку |
| `commit_message` | string | нет | Сообщение коммита |
| `run_url` | string | да | Ссылка на GitHub Actions run |

**Ответы**

| Код | Описание |
|---|---|
| `202` | `{"release_id": "<id>"}` — релиз создан, сообщение отправлено |
| `400` | Ошибка валидации |
| `401` | Неверный или отсутствующий shared secret |

**Пример**

```bash
curl --fail-with-body \
  --request POST https://releasebot.<account>.workers.dev/build-notifications \
  --header 'Content-Type: application/json' \
  --header "X-Releasebot-Secret: ${RELEASEBOT_SHARED_SECRET}" \
  --data '{
    "repository": "SOTBI-LLC/service",
    "ref": "main",
    "branch": "main",
    "sha": "abc123",
    "tag": "v1.2.3",
    "actor": "octocat",
    "commit_message": "test release",
    "run_url": "https://github.com/SOTBI-LLC/service/actions/runs/1"
  }'
```

### `POST /telegram/webhook`

Обработчик webhook Telegram. Защищён заголовком `X-Telegram-Bot-Api-Secret-Token` (если задан `TELEGRAM_WEBHOOK_SECRET_TOKEN`). Ответ: `204 No Content`.

---

## Конфигурация

### Переменные (`wrangler.jsonc` → `[vars]`)

| Переменная | Описание |
|---|---|
| `GITHUB_API_BASE_URL` | Базовый URL GitHub API (по умолчанию `https://api.github.com`) |
| `TELEGRAM_API_BASE_URL` | Базовый URL Telegram API |
| `RELEASEBOT_WORKFLOW_FILE` | Имя workflow-файла для dispatch (например `restart.yaml`) |
| `TELEGRAM_ALLOWED_USER_IDS` | Список Telegram user id через запятую — кому разрешено жать кнопки |
| `TELEGRAM_CHAT_ID` | ID чата, куда отправляются уведомления о сборке |

### Секреты (`wrangler secret put`)

| Секрет | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота |
| `TELEGRAM_BOT_INFO` | JSON-ответ `getMe` одной строкой (чтобы не вызывать `getMe` на каждый запрос) |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | Secret token для webhook |
| `GITHUB_TOKEN` | PAT или GitHub App token с правом `actions:write` |
| `RELEASEBOT_SHARED_SECRET` | Shared secret для `X-Releasebot-Secret` |

Получить `TELEGRAM_BOT_INFO`:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
# сохраните поле result как однострочный JSON
```

### Локальная разработка (`.dev.vars`)

```bash
# .dev.vars — НЕ коммитить
TELEGRAM_BOT_TOKEN=123456:AA...
TELEGRAM_BOT_INFO={"id":123456,"is_bot":true,"first_name":"ReleaseBot","username":"my_release_bot"}
TELEGRAM_WEBHOOK_SECRET_TOKEN=dev-secret
GITHUB_TOKEN=ghp_xxx
RELEASEBOT_SHARED_SECRET=dev-shared-secret
```

`wrangler dev` автоматически подхватывает `.dev.vars`.

---

## Подготовка Telegram

Перед деплоем нужно получить значения для `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` и `TELEGRAM_ALLOWED_USER_IDS`.

### 1. Создать бота

1. Создать бота через `@BotFather` и сохранить token в `TELEGRAM_BOT_TOKEN`.
2. Добавить бота в Telegram-чат или канал, куда будут приходить build-уведомления.
3. Получить `TELEGRAM_BOT_INFO` (см. выше) и сохранить как секрет.

### 2. Получить `TELEGRAM_CHAT_ID`

1. Добавить бота в нужную группу или канал.
2. Написать в чат любое сообщение, например `/start` или `test`.
3. Выполнить:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
```

4. Найти `message.chat.id` в ответе:

```json
{
  "message": {
    "chat": {
      "id": -123456789,
      "title": "SOTBI releases",
      "type": "group"
    }
  }
}
```

5. Сохранить значение `id` целиком в `wrangler.jsonc` → `[vars]` или в `.dev.vars` для локальной разработки.

Для супергрупп и каналов `chat_id` обычно начинается с `-100`, например `-1001234567890`. Минус — часть id, его нужно сохранять.

Если `getUpdates` возвращает пустой `result`:

- бот добавлен в чат, но после добавления не было новых сообщений;
- у бота включён webhook — временно удалить его, затем повторить:

```bash
curl --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```

После деплоя webhook регистрируется заново (см. [Регистрация webhook](#регистрация-webhook)).

### 3. Получить `TELEGRAM_ALLOWED_USER_IDS`

Numeric user id — id Telegram-аккаунта, не username и не `@login`. Список id через запятую: кто имеет право нажимать release-кнопки.

**Способ A — через `getUpdates`:** пользователь пишет боту в личку `/start`, затем:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
```

Найти `message.from.id`:

```json
{
  "message": {
    "from": {
      "id": 123456789,
      "is_bot": false,
      "first_name": "Ivan",
      "username": "ivan"
    }
  }
}
```

**Способ B — через callback:** если бот уже отправил release-сообщение, id будет в `callback_query.from.id` (удобно, когда webhook уже работает).

**Способ C — через бота-помощника:** например `@userinfobot` — в whitelist добавлять число, не username.

### Различия

| Переменная | Что это | Пример |
|---|---|---|
| `TELEGRAM_CHAT_ID` | Куда бот отправляет release-сообщения (группа, канал, личка) | `-1001234567890` |
| `TELEGRAM_ALLOWED_USER_IDS` | Кто может нажимать release-кнопки (id пользователей) | `123456789,987654321` |

Whitelist проверяется на каждом callback: если пользователь видит сообщение, но его id не в списке, кнопки не сработают.

---

## Быстрый старт

### Требования

- Node.js 24+
- Yarn (через corepack)
- Аккаунт Cloudflare + `wrangler login`

### Установка и запуск

```bash
corepack enable
yarn install
yarn dev          # wrangler dev, порт 8787 по умолчанию
```

### Тесты

```bash
yarn test         # vitest
yarn vitest run   # однократный прогон (как в CI)
```

### Деплой

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_BOT_INFO
wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN
wrangler secret put GITHUB_TOKEN
wrangler secret put RELEASEBOT_SHARED_SECRET

yarn deploy       # wrangler deploy
```

При push в `main` деплой выполняется автоматически через `.github/workflows/deploy.yaml` (нужны секреты `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`).

### Регистрация webhook

После деплоя:

```bash
curl --request POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --form "url=https://releasebot.<account>.workers.dev/telegram/webhook" \
  --form "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN}"
```

Проверка:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

### Локальная отладка webhook

Telegram не достучится до `localhost` — нужен публичный туннель:

```bash
yarn dev
cloudflared tunnel --url http://localhost:8787   # или ngrok http 8787

curl --request POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --form "url=https://<TUNNEL_URL>/telegram/webhook" \
  --form "secret_token=dev-secret"
```

---

## Архитектурные ограничения Workers

Прочитать **до** доработок — несколько решений нельзя исправить «по пути» без переделки архитектуры.

### Stateless-природа воркера

Worker — обработчик одного запроса, а не долгоживущий сервер. Изолят может быть выгружен между запросами. Любое состояние между `release:` и `deploy:` обязано жить в Durable Object, а не в module-scope переменной.

Используется **один именованный инстанс** Durable Object (`idFromName("global")`) — все обращения сериализуются рантаймом.

### Long polling недоступен

Единственный реалистичный режим для прод-бота на Workers — **webhook**. Telegram сам доставляет апдейты на `POST /telegram/webhook`.

### Повторная доставка апдейтов

Telegram при таймауте или 5xx **повторяет** апдейт. Повторный `deploy:id:env` снова вызовет `workflow_dispatch`. При необходимости добавьте дедупликацию по `update_id` в Durable Object.

### KV не подходит для release-store

Workers KV реплицируется с задержкой до 60 секунд. Durable Object даёт строгую консистентность — поэтому выбран именно DO.

---

## Мониторинг и откат

| Задача | Команда |
|---|---|
| Live-логи | `wrangler tail` |
| Список деплоев | `wrangler deployments list` |
| Откат | `wrangler rollback [deployment-id]` |

Observability включена в `wrangler.jsonc`. Для долгого хранения логов настройте Logpush.

---

## Чек-лист готовности к production

- [ ] `wrangler deploy --dry-run` проходит без предупреждений о размере бандла
- [ ] `setWebhook` зарегистрирован с `secret_token`, `getWebhookInfo` не показывает `last_error_message`
- [ ] Все секреты заданы через `wrangler secret put`, ни один не попал в git
- [ ] `TELEGRAM_ALLOWED_USER_IDS` проверен (чужой аккаунт получает отказ)
- [ ] Durable Object alarm чистит протухшие релизы (проверить через `wrangler tail`)
- [ ] Повторная доставка Telegram update не приводит к нежелательному двойному deploy, либо это осознанно допустимо
- [ ] Настроен `wrangler tail` / Logpush для отладки инцидентов
- [ ] План отката (`wrangler rollback`) описан и протестирован

---

## Лицензия

Приватный репозиторий SOTBI-LLC.
