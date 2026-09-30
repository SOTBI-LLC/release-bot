# __BOT_NAME__

Telegram-бот на Cloudflare Workers. Обработчики команд и сообщений находятся в `src/bot.ts`, HTTP-роуты — в `src/index.ts`.

Из корня репозитория:

```bash
yarn install
yarn workspace @bots/__BOT_NAME__ cf-typegen
cp apps/__BOT_NAME__/.dev.vars.example apps/__BOT_NAME__/.dev.vars
# Заполнить .dev.vars собственными секретами этого бота.
yarn workspace @bots/__BOT_NAME__ dev
yarn workspace @bots/__BOT_NAME__ test:run
yarn workspace @bots/__BOT_NAME__ deploy:check
```

Перед первым деплоем задайте секреты:

```bash
yarn workspace @bots/__BOT_NAME__ exec wrangler secret put TELEGRAM_BOT_TOKEN
yarn workspace @bots/__BOT_NAME__ exec wrangler secret put TELEGRAM_BOT_INFO
yarn workspace @bots/__BOT_NAME__ exec wrangler secret put TELEGRAM_WEBHOOK_SECRET_TOKEN
yarn workspace @bots/__BOT_NAME__ deploy
```

`TELEGRAM_BOT_INFO` — поле `result` ответа Telegram `getMe`, записанное одной строкой JSON.

Зарегистрируйте webhook в Telegram через `setWebhook`: URL `https://__BOT_NAME__.<account>.workers.dev/telegram/webhook`, `secret_token` равен `TELEGRAM_WEBHOOK_SECRET_TOKEN` этого бота.

Для автоматического деплоя добавьте имя `__BOT_NAME__` в матрицу `.github/workflows/deploy.yaml`. Для отдельного Cloudflare-аккаунта задайте `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` в GitHub Environment `__BOT_NAME__`.
