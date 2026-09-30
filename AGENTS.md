# Telegram bots on Cloudflare Workers

Монорепозиторий Yarn workspaces: каждый `apps/<bot>` — независимый Telegram-бот и Cloudflare Worker со своими `wrangler.jsonc`, bindings, секретами и тестами. Общие Telegram-утилиты — в `packages/telegram-worker`, шаблон нового бота — в `templates/telegram-bot`.

- Новый бот: `yarn bot:create <name>`, затем `yarn install`.
- Команды конкретного бота: `yarn workspace @bots/<name> dev`, `deploy`, `cf-typegen`, `test:run`.
- Проверки всего репозитория: `yarn typecheck`, `yarn test:run`, `yarn deploy:check`.
- Корневые `dev`, `deploy`, `cf-typegen` сохранены как команды releasebot.
- Секреты и локальное состояние принадлежат приложению: `apps/<bot>/.dev.vars`, `apps/<bot>/.wrangler`. Команды Wrangler выполняй из workspace выбранного бота.
- Новые боты включаются в автоматический деплой явно через матрицу `.github/workflows/deploy.yaml`.
- Бизнес-логика и хранилища остаются внутри приложения; выноси в `packages` только код, общий для разных ботов.

`apps/releasebot` принимает `POST /build-notifications`, публикует release-кнопку в Telegram и запускает GitHub Actions через `workflow_dispatch`. Состояние: `ReleaseStore` (`RELEASE_STORE`), TTL 24 ч. При переносах сохраняй имя Worker `releasebot`, класс `ReleaseStore` и историю миграций: это идентичность существующего деплоя и данных.

Документация: `README.md`, для releasebot — `apps/releasebot/README.md`. Скиллы в `.agents/skills`.

---

# Skills

Загружай соответствующий скилл **до** того, как писать код или команды.

| Скилл | Когда загружать |
|-------|-----------------|
| `workers-best-practices` | Любая правка или ревью кода Worker: роуты Hono, обработчики, конфиг `wrangler.jsonc`, проверка на анти-паттерны (floating promises, глобальное состояние, секреты) |
| `durable-objects` | Любая работа с `ReleaseStore`: методы RPC, TTL/alarms, миграции классов DO, тесты через `@cloudflare/vitest-pool-workers` |
| `wrangler` | Перед любой командой `wrangler` (dev/deploy/secret/types) или правкой `wrangler.jsonc` — флаги и схема конфига меняются между версиями |
| `cloudflare` | Общий вход в платформу, если задача выходит за текущий стек (KV, R2, Queues) — дерево решений ведёт к нужному продукту |

---

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `yarn workspace @bots/<name> dev` | Local development |
| `yarn workspace @bots/<name> deploy` | Deploy to Cloudflare |
| `yarn workspace @bots/<name> cf-typegen` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
