# Arcanorum (Vite + React + WEGO)

Монорепо с клиентом и сервером для пошаговой WEGO-стратегии.

## Стек
- Клиент: Vite + React + TypeScript, Tailwind, Zustand (`worldBase + ordersOverlay`), maplibre, framer-motion, lucide-react, Headless UI Tabs, floating-ui (кастомный tooltip), radix-ui, sonner, cmdk, react-hook-form + zod, colord
- Сервер: Node + Express + WS, jsonwebtoken, SQLite + Prisma
- Опционально: Redis (presence/rate-limit/pubsub/planning cache)

## Структура
- `apps/client` — UI и WebSocket-клиент
- `apps/server` — authoritative правила, auth, map tiles (MVT), resolve turn
- `packages/shared` — общие типы и ADM1 sample
- `standarts.md` — единые стандарты UI, механик, производительности и процесса разработки

## Подготовка
1. Скопируйте `apps/server/.env.example` в `apps/server/.env`
2. БД по умолчанию: SQLite (`apps/server/prisma/dev.db`)
3. Выполните:

```bash
npm install
npm run prisma:generate -w @arcanorum/server
npm run prisma:push -w @arcanorum/server
```

## Запуск
```bash
npm run dev
```

Сервер: `http://localhost:3001`
Клиент: `http://localhost:5173`

## WEGO-поток
1. Клиенты отправляют `OrderDelta`
2. Сервер валидирует и ретранслирует `ORDER_BROADCAST`
3. В конце фазы `REQUEST_RESOLVE` → `ResolveTurn()`
4. Всем рассылается `WORLD_DELTA` (компактный формат с `mask` и короткими ключами) + `rejectedOrders`

## Синхронизация мира
- При авторизации клиент получает полный snapshot через `AUTH_OK` (`worldBase`, `turnId`, `worldStateVersion`).
- Далее применяются только `WORLD_DELTA`.
- Клиент отправляет `WORLD_DELTA_ACK` после применения дельт.
- При разрыве последовательности запрашивается `WORLD_DELTA_REPLAY_REQUEST`.
- Если replay недоступен, используется `GET /world/snapshot` для мягкого ресинка.
- Broadcast игровых WS-сообщений отправляется только авторизованным сокетам; `NEWS_EVENT` с `visibility=private` маршрутизируются только целевой стране и администраторам.
- Серверный diff `WORLD_DELTA` для `colonyProgressByProvince` использует структурное сравнение map-объектов (без `JSON.stringify`) для снижения CPU-нагрузки.
- В turn-resolve используется индекс активных колонизаций (`country -> provinces`), что уменьшает количество полных проходов по `colonyProgressByProvince`.
- `MapView` на клиенте подписан на отдельные ветки `worldBase`, а не на весь объект, чтобы уменьшить лишние ререндеры при нерелевантных дельтах.
- На сервере используются инкрементальные индексы очереди приказов (`COLONIZE`/`BUILD`) и индекс экономического тика стран, чтобы убрать полные обходы в hot-path проверок и начислений.
- Серверный delta-pipeline использует partial snapshot по dirty-sections вместо полного клона `worldBase` перед diff, что уменьшает стоимость CPU/GC при частых локальных мутациях.

## Админ-диагностика
- `GET /admin/ws-delta-metrics` — метрики размера WS-дельт (compact vs baseline).
- `POST /admin/ws-delta-metrics/reset` — сброс метрик.
- `GET /admin/world-delta-log/status` — состояние персистентного журнала дельт (БД и in-memory replay window).
- `GET /admin/provinces?q=...&limit=...&offset=...` — список провинций с поиском и опциональной пагинацией.

## Население (POP)
- Базовый контракт POP: `countryId`, `provinceId`, `size`, `cultureId`, `religionId`, `raceId`.
- Кнопка `Население` в левой навигации открывает статистику населения текущей страны.
- Админ-инструменты:
  - `GET /admin/population/pops` — просмотр POP с фильтрами/лимитом.
  - `POST /admin/population/pops` / `PATCH /admin/population/pops/:popId` / `DELETE /admin/population/pops/:popId` — управление POP.
  - `POST /admin/population/generate` — массовая генерация POP.
  - `GET /population/country-stats` — агрегированная статистика по стране (по культурам/религиям/расам/провинциям).

## Важно для Windows
В текущем окружении запуск Vite может ломаться из пути с пробелом (`...\Ages 3`) из-за `esbuild` (`spawn EFTYPE`).
Решение: перенести проект в путь без пробелов (например `C:\arcanorum`) и запускать оттуда.
