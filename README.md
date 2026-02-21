# Arcanorum (Vite + React + WEGO)

Монорепо с клиентом и сервером для пошаговой WEGO-стратегии.

## Стек
- Клиент: Vite + React + TypeScript, Tailwind, Zustand (`worldBase + ordersOverlay`), maplibre, framer-motion, lucide-react, Headless UI Tabs, floating-ui (кастомный tooltip), radix-ui, sonner, cmdk, react-hook-form + zod, colord
- Сервер: Node + Express + WS, jsonwebtoken, PostgreSQL + Prisma
- Опционально: Redis (presence/rate-limit/pubsub/planning cache)

## Структура
- `apps/client` — UI и WebSocket-клиент
- `apps/server` — authoritative правила, auth, map tiles (MVT), resolve turn
- `packages/shared` — общие типы и ADM1 sample

## Подготовка
1. Скопируйте `apps/server/.env.example` в `apps/server/.env`
2. Поднимите PostgreSQL и создайте БД `arcanorum`
3. Выполните:

```bash
npm install
npm run prisma:generate -w @arcanorum/server
npm run prisma:migrate -w @arcanorum/server
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
4. Всем рассылается `WORLD_PATCH` + `rejectedOrders`

## Важно для Windows
В текущем окружении запуск Vite может ломаться из пути с пробелом (`...\Ages 3`) из-за `esbuild` (`spawn EFTYPE`).
Решение: перенести проект в путь без пробелов (например `C:\arcanorum`) и запускать оттуда.
