# Telegram bots on Cloudflare Workers

Монорепозиторий для разных Telegram-ботов. Каждый бот — отдельный Cloudflare Worker со своей логикой, URL, секретами и хранилищами. Зависимости устанавливаются одним `yarn install` из корня, приложения связаны через Yarn workspaces.

Текущий бот [releasebot](apps/releasebot/README.md) принимает уведомления из CI и запускает релизы через GitHub Actions.

## Структура

```text
apps/
  releasebot/              # существующий бот релизов
    src/                  # логика, HTTP-роуты, ReleaseStore
    test/                 # тесты этого Worker
    package.json
    wrangler.jsonc        # имя Worker, vars, bindings, миграции
    worker-configuration.d.ts
    tsconfig.json
    vitest.config.mts
    .dev.vars.example
packages/
  telegram-worker/        # создание grammY Bot и проверка shared secret
scripts/
  create-bot.mjs          # создание приложения из шаблона
  check-deployments.mjs   # dry-run сборки всех ботов
  test/                  # проверки генератора
templates/               # шаблоны не входят в workspaces и не деплоятся
  telegram-bot/
tsconfig.base.json        # общие настройки TypeScript
vitest.config.mts         # тесты всех приложений и общих пакетов
package.json              # workspaces и общие инструменты
yarn.lock                # единый lockfile
```

Каждый `apps/<name>` содержит пакет `@bots/<name>`. Бизнес-логика, bindings и Durable Objects принадлежат конкретному боту. Общий код размещается в `packages`; приложения подключают его как зависимость. У каждого Worker собственные типы bindings и отдельный TypeScript-проект: объявления `Env` разных ботов не смешиваются.

## Установка и проверки

Требования: Node.js 24+, Yarn 1.22.22 через Corepack, аккаунт Cloudflare для деплоя.

```bash
corepack enable
yarn install

yarn typecheck            # генерация bindings + TypeScript всех workspaces
yarn test:run             # все тесты однократно
yarn test                 # все тесты в watch-режиме
yarn deploy:check         # сборка всех Worker без публикации
```

Инструменты разработки (Wrangler, TypeScript, Vitest) находятся в корневом `package.json`. Runtime-зависимости объявляются в пакете бота или общем пакете, который их использует. Дата совместимости в шаблоне согласована с runtime зафиксированных Wrangler/Vitest; обновляйте её вместе с инструментами.

## Создать нового бота

```bash
yarn bot:create support-bot
yarn install
yarn workspace @bots/support-bot cf-typegen
cp apps/support-bot/.dev.vars.example apps/support-bot/.dev.vars
# Заполнить .dev.vars собственными значениями из BotFather и getMe.
yarn workspace @bots/support-bot dev
```

Генератор создаёт `apps/support-bot` с уникальным именем Worker `support-bot`, конфигом, тестами и README. Он проверяет имя и отказывается перезаписывать существующее приложение. Шаблон содержит `/start`, echo-обработчик текстовых сообщений, `GET /healthz` и защищённый `POST /telegram/webhook`.

Добавляйте команды и обработчики в `apps/support-bot/src/bot.ts`, дополнительные HTTP-роуты — в `src/index.ts`. Для нового хранилища добавьте bindings и миграции в конфиг этого бота, затем повторите `cf-typegen`.

```bash
yarn workspace @bots/support-bot test:run
yarn workspace @bots/support-bot typecheck
yarn workspace @bots/support-bot deploy:check
```

Можно параллельно запускать разных ботов на разных портах:

```bash
yarn workspace @bots/releasebot dev --port 8787
yarn workspace @bots/support-bot dev --port 8788
```

## Секреты и деплой

В `apps/<name>/wrangler.jsonc` храните несекретные настройки. Локальные секреты — в `apps/<name>/.dev.vars`, локальное состояние Wrangler — в `apps/<name>/.wrangler`. Эти файлы исключены из Git. Команды через `yarn workspace` выполняются в каталоге выбранного бота, поэтому Wrangler использует именно его конфиг и секреты.

Для нового бота:

```bash
yarn workspace @bots/support-bot exec wrangler login
yarn workspace @bots/support-bot exec wrangler secret put TELEGRAM_BOT_TOKEN
yarn workspace @bots/support-bot exec wrangler secret put TELEGRAM_BOT_INFO
yarn workspace @bots/support-bot exec wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN
yarn workspace @bots/support-bot deploy
```

`TELEGRAM_BOT_INFO` — поле `result` ответа Telegram `getMe`, записанное одной строкой JSON. `TELEGRAM_WEBHOOK_SECRET_TOKEN` — случайный секрет этого бота.

После деплоя зарегистрируйте webhook через Telegram `setWebhook`: URL `https://support-bot.<account>.workers.dev/telegram/webhook`, `secret_token` равен секрету этого бота. Для каждого приложения используйте отдельный токен Telegram; у одного Telegram-бота может быть только один активный webhook.

Конфигурация, дополнительные секреты и HTTP API releasebot описаны в [его README](apps/releasebot/README.md).

## CI/CD

[GitHub Actions](.github/workflows/deploy.yaml) проверяет типы, запускает все тесты и dry-run сборки всех ботов. На push в `main` каждый бот из `deploy.strategy.matrix.bot` деплоится отдельным job из `apps/<name>`.

Изначально в матрице только `releasebot`. Чтобы включить готового бота в автодеплой, добавьте его имя:

```yaml
matrix:
  bot: [releasebot, support-bot]
```

Создание приложения само по себе не включает автодеплой. Перед добавлением в матрицу настройте Worker secrets и Telegram webhook. Шаблоны не попадают в тестовые проекты или сборки.

Деплой использует `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` из GitHub Secrets. Job выбирает GitHub Environment с именем бота: в нём можно задать отдельные Cloudflare credentials и правила защиты. Repository secrets продолжают работать для существующего аккаунта.

## Перенос существующего releasebot

Исходники, тесты и конфиг перенесены в `apps/releasebot`. Имя Worker `releasebot`, HTTP-роуты, класс `ReleaseStore` и миграция `v1` сохранены; следующий деплой обновляет существующий Worker и сохраняет его URL и Durable Object namespace.

Для совместимости корневые команды `yarn dev`, `yarn start`, `yarn deploy`, `yarn cf-typegen` вызывают releasebot. Корневой `yarn test` запускает тесты всех проектов.

В существующей локальной копии перенесите игнорируемые файлы, если они остались в корне:

```bash
mv .dev.vars apps/releasebot/.dev.vars     # если файл существует
mv .wrangler apps/releasebot/.wrangler     # если нужен прежний локальный state
```

Внешние скрипты, которые запускали Wrangler из корня напрямую, переведите на `yarn workspace @bots/releasebot ...` или передавайте `--config apps/releasebot/wrangler.jsonc`.

Подход соответствует [Yarn workspaces](https://classic.yarnpkg.com/lang/en/docs/workspaces/), [конфигурации Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/) и [Vitest projects](https://vitest.dev/guide/projects).
