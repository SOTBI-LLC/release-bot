# alertbot

Grafana Alerting → Cloudflare Worker → SQLite Durable Object → один Telegram-чат. Бот принимает только стандартный Grafana JSON, сохраняет групповую сводку и доставляет firing/resolved по порядку внутри groupKey. Telegram inbound webhook, команды, getMe и TELEGRAM_BOT_INFO не требуются.

## Локальная подготовка

Из корня монорепозитория:

```sh
yarn install --frozen-lockfile
cp apps/alertbot/.dev.vars.example apps/alertbot/.dev.vars
# Заполнить новый bot token, chat ID и два независимых случайных секрета.
yarn workspace @bots/alertbot cf-typegen
yarn workspace @bots/alertbot dev --port 8788
yarn workspace @bots/alertbot test:run
yarn workspace @bots/alertbot typecheck
yarn workspace @bots/alertbot deploy:check
```

`.dev.vars` исключён из Git. Для нового бота используйте отдельный BotFather token. Добавьте его в единственный выбранный чат с правом отправлять сообщения. `TELEGRAM_CHAT_ID` берётся из настроек развёртывания; payload не может менять получателя.

## HTTP API

| Route | Авторизация | Результат |
|---|---|---|
| GET /healthz | без секрета | 204, Worker отвечает; доставки не доказывает |
| POST /grafana/webhook | Bearer GRAFANA_WEBHOOK_SECRET | 202 с accepted=true/notificationId только после durable сохранения |
| GET /delivery/status | Bearer DELIVERY_ADMIN_SECRET | depth, bytes, oldestAgeMs, paused, inFlight, nextSendAt, counts, recent (последние20 IDs/states) |
| GET /delivery/status/:id | отдельный admin secret | metadata, progress и подтверждённые messageIds; 404 для неизвестного/очищенного ID |
| POST /delivery/pause | отдельный admin secret | запрет новых попыток; текущий inFlight может завершиться |
| POST /delivery/resume | отдельный admin secret | возобновление сохранённой очереди |

Ответы ingress: 401 при неправильном секрете, 400 при invalid JSON/schema, 413 при превышении фактического/объявленного тела, 503 при missing config, storage/scheduling failure или переполнении. При 503 ранее принятые задания сохраняются. 202 означает **принято в очередь**, а не получено Telegram. События, которые Grafana не смогла передать до acceptance, эта очередь не сохраняет; полагаться на гарантированный replay Grafana нельзя.

Пример результата: `{"accepted":true,"notificationId":"<uuid>"}`. Данные диагностики не содержат исходного текста и токенов. Коды `telegram_400/401/403` означают окончательный отказ; `telegram_429`, `telegram_transport`, `telegram_5xx` — повтор. Подробные произвольные Telegram descriptions не логируются.

## Сводки и ограничения

Сводка показывает общий и индивидуальные статусы, alertname, labels, annotations (summary/description/condition/runbook), время начала/завершения и доступные source/dashboard/panel links. Plain text безопасно отображает произвольный Markdown/HTML. Длинный текст разбивается на части <=4096 UTF-16 code units с запасом под ID, времена и part number; Unicode не повреждается, содержимое не обрезается.

Resolved означает, что Grafana больше не считает алерт firing. Для ProductionWriteFailed/ProductionWriteProbeStale сообщение требует нового успешного write probe, а не заявляет восстановление записи. EtcdNoSpace сохраняет напоминание о ручном disarm после освобождения места. `truncatedAlerts>0` явно обозначает неполную исходную группу.

При ожидании более60секунд заголовок сообщает «ЗАДЕРЖАННАЯ ДОСТАВКА», время приёма и отправки; событие сохраняет собственный startsAt. Firing и последующий resolved не сворачиваются в последнее состояние. Одинаковые groupKey/fingerprint не подавляют Grafana reminders.

Defaults в Wrangler vars: WEBHOOK_BODY_LIMIT=262144 bytes, OUTBOX_MAX_PENDING=1000, OUTBOX_MAX_BYTES=67108864 bytes подготовленных частей и groupKey. Значения должны быть положительными целыми. Requests без Content-Length тоже ограничиваются потоком. Max Alerts в Grafana должен оставаться0; oversized группа получает явный отказ, а не молча обрезается.

## Очередь и повторы

`ALERT_OUTBOX` / `AlertOutbox` — отдельный SQLite DO с начальной migration v1; ReleaseStore другого бота не используется. Один объект на environment/chat хранит sequence, groupKey/priority, body частей, подтверждённый cursor, lease, retry schedule и throttle. Enqueue+alarm атомарны. После durable acceptance ускоряющий drain выполняется через waitUntil; alarm продолжает работу после перезапуска даже без новых webhook.

Состояния: queued → partial/retry → delivered либо failed/expired. Delivered требует Telegram message_id для всех частей; прочтение человеком не подтверждается. Подтверждённые durable части намеренно не повторяются. Если Telegram отправил сообщение, но ответ/его checkpoint потерян, неподтверждённая часть может повториться: редкий дубль допустим, exactly-once не обещается.

Отправка ограничена одной частью за drain и минимум4секундами между запросами чата. HTTP timeout10секунд, durable recovery lease30секунд. Network/timeouts/5xx повторяются с jitter/backoff5секунд→5минут, 429 учитывает retry_after для всего чата. Повторы ограничены24часами от приёма; новый запрос после expiresAt не начинается. Постоянный отказ или expiry освобождает head; confirmedParts/totalParts показывают частичную доставку. Встроенные шесть retry alarm не используются как весь retry механизм — расписание перевыставляется явно.

Группы ProductionNoPrimary, ProductionPrimaryVisibilityLost, ProductionWriteFailed и ProductionWriteProbeStale имеют приоритет среди готовых первых заданий каждой groupKey; далее действует sequence. Срочная независимая группа прерывает обычную между частями. Части и firing→resolved внутри groupKey сохраняют порядок. Временная ошибка задерживает свою группу, retry_after — весь чат. Непрерывный поток срочных групп может задержать обычные до expiry; следите за возрастом и failed/expired. Во время pause expiry также продолжается. Terminal body удаляется; metadata остаётся7дней и очищается alarm. За эти7дней доступны counts и причины ошибок. Никакой гарантии доставки при непрерывном24h outage нет.

## Развёртывание и Grafana

Заполните TELEGRAM_CHAT_ID в конфиге этого Worker перед production deploy, затем добавьте секреты через интерактивные Wrangler prompts (из workspace бота):

```sh
yarn workspace @bots/alertbot exec wrangler secret put TELEGRAM_BOT_TOKEN
yarn workspace @bots/alertbot exec wrangler secret put GRAFANA_WEBHOOK_SECRET
yarn workspace @bots/alertbot exec wrangler secret put DELIVERY_ADMIN_SECRET
yarn workspace @bots/alertbot deploy
```

Не передавайте значения секретов в argv/echo/логи. После deployment должен существовать HTTPS `/grafana/webhook` и DO migration. CI использует bot-specific GitHub environment `alertbot` с Cloudflare credentials; бот включён в явную matrix. Секреты Worker задаются отдельно, не создаются автоматически деплоем. Root deploy по-прежнему вызывает releasebot.

Настройки contact point ведёт репозиторий `sotbi-k8s`: UID telegram_alertbot, POST, bearer reference, resolved enabled, maxAlerts0, стандартный payload. Grafana admin credentials не передаются Worker. Сначала разверните contact point с прежними production receivers; затем проверьте реальное получение firing/resolved и budget90s/6m на безопасных synthetic scenarios, включая concurrent burst. Только успешный gate разрешает переключить notify=patroni-prod parent и write child. `notify=telegram-test`, redpanda и fallback остаются прежними.

## Диагностика и откат

Проверяйте oldestAgeMs, depth, counts.retry/failed/expired, inFlight и per-job lastError независимо от целевого чата. Непустая растущая очередь — задержка доставки, даже при healthz204. Сверяйте ошибки notification в Grafana и Worker structured logs. При401 проверьте совпадение webhook secrets; при403 Telegram — доступ бота в чат; при429 — соблюдайте retry_after. 413/503 требуют проверки ingress/storage capacity и Grafana group size.

Для admin-запроса можно использовать Python, считывающий secret из локального файла, без значения в argv:

```python
from pathlib import Path
import json, urllib.request
values = dict(line.split('=', 1) for line in Path('apps/alertbot/.dev.vars').read_text().splitlines() if line and not line.startswith('#'))
base = 'https://alertbot.<account>.workers.dev'
req = urllib.request.Request(base + '/delivery/status', headers={'Authorization': 'Bearer ' + values['DELIVERY_ADMIN_SECRET']})
with urllib.request.urlopen(req, timeout=15) as response:
    print(json.load(response))
```

Перед откатом: сохраните metadata/backlog, вызовите POST /delivery/pause с отдельным admin secret, дождитесь или зафиксируйте inFlight. Верните **оба** production receivers на telegram-default через authoritative provisioning, сохранив live policy tree и unrelated routes; проверьте старую доставку. Очередь/DO migration не удаляйте. Resume старого backlog после отката может дать сознательные дубли и требует решения оператора. Уже отправленное сообщение отменить невозможно.
