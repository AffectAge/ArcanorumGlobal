# AGENT_INSTRUCTIONS.md

Инструкции для ИИ-агента по работе с проектом `Ages3` (Arcanorum).

## 1) Назначение проекта
- Монорепозиторий онлайн-стратегии WEGO.
- Сервер authoritative: все критичные решения, валидации и резолв хода происходят на сервере.
- Клиент отображает состояние мира и отправляет команды.
- Синхронизация мира идет через `WORLD_DELTA` (с `mask`, `worldStateVersion`, ACK/REPLAY), а не через полный full-sync.

## 2) Структура репозитория
- `apps/server` - API, WebSocket, authoritative игровая логика, Prisma/SQLite, тайлы карты.
- `apps/client` - React/Vite UI, Zustand store, maplibre, модалки и панели управления.
- `packages/shared` - единый контракт типов (WS/API/WorldBase/дельты).
- `project_assets` - исходные ассеты (иконки и прочее).
- `apps/server/uploads` - пользовательские/админские загруженные изображения.
- `apps/server/data` и `apps/client/public/data` - геоданные и MVT-тайлы.

## 3) Ключевой принцип изменений
Любое изменение протокола или структуры мира делается только синхронно в 3 местах:
1. `packages/shared/src/index.ts` (источник истины типов)
2. `apps/server/src/index.ts` (производство/валидация/рассылка)
3. `apps/client/src/store/gameStore.ts` + клиентские обработчики (`App.tsx`, `lib/api.ts`)

Если обновить только одну сторону, почти гарантирован рассинхрон и ошибки применения дельт.

## 4) Что читать в первую очередь
1. `README.md` - запуск и общий поток WEGO.
2. `standarts.md` - обязательные стандарты UI, механик, perf и процесса.
3. `AI_NOTES.md` - история последних этапов, рисков и проверок.
4. `CHANGELOG.md` - сводка изменений.
5. `packages/shared/src/index.ts` - все контракты.
6. `apps/server/src/index.ts` - основной серверный runtime (очень большой файл).
7. `apps/client/src/App.tsx` и `apps/client/src/store/gameStore.ts` - клиентский orchestration + применение дельт.
8. `apps/client/src/lib/api.ts` и `apps/client/src/lib/useWs.ts` - HTTP/WS интеграция.

## 5) Запуск и базовые команды
Из корня репозитория:
```bash
npm install
npm run prisma:generate -w @arcanorum/server
npm run prisma:push -w @arcanorum/server
npm run dev
```

Проверки перед завершением работы:
```bash
npm run typecheck -ws
```

Дополнительно:
- Сервер: `http://localhost:3001`
- Клиент: `http://localhost:5173`
- Публичные тайлы: `/tiles/adm1/:z/:x/:y.mvt`
- Snapshot-ресинк: `GET /world/snapshot`

## 6) Переменные окружения
Файл: `apps/server/.env` (на основе `.env.example`).
Минимум:
- `DATABASE_URL="file:./prisma/dev.db"`
- `JWT_SECRET="dev_secret_change_me"`
- `PORT=3001`
- `SERVER_STATUS="online"`
- `REDIS_URL=""` (опционально)

## 7) Контуры архитектуры (кратко)
### Сервер
- Весь основной код в `apps/server/src/index.ts`.
- Хранение состояния: Prisma + SQLite (`Country`, `GameState`, `WorldDeltaLog`).
- Реализованы:
  - auth/login/register,
  - управление странами и админка,
  - контент-библиотека,
  - колонизация/постройки/экономика/рынки,
  - population,
  - turn resolve,
  - WS-синхронизация c replay.
- Есть метрики и диагностика:
  - `GET /admin/ws-delta-metrics`
  - `POST /admin/ws-delta-metrics/reset`
  - `GET /admin/world-delta-log/status`

### Клиент
- `App.tsx` маршрутизирует ключевые UI-состояния, websocket events, ресинк и модалки.
- `gameStore.ts` применяет `WORLD_DELTA` по `mask` (ветки `c/o/n/p/z/s/u/b/q/y/r/t/e/k`).
- `api.ts` содержит typed-обертки над всеми REST-эндпоинтами.
- `useWs.ts` авторизует сокет и отправляет WS-сообщения.

## 8) Важные WS-правила
- После `AUTH_OK` клиент получает полный snapshot.
- Далее состояние обновляется только дельтами `WORLD_DELTA`.
- После применения дельты клиент отправляет `WORLD_DELTA_ACK`.
- При дырке по версии отправляется `WORLD_DELTA_REPLAY_REQUEST`.
- Если replay недоступен, клиент должен делать `GET /world/snapshot`.

## 9) Правила безопасного редактирования
1. Не менять большие бинарные/данные каталоги без явной причины:
- `apps/server/data/tiles/**`
- `apps/client/public/data/tiles/**`
- `apps/server/uploads/**`
- `node_modules/**`

2. При изменении игрового состояния/резолва:
- учитывать `mask` дельт,
- не ломать deterministic поведение,
- избегать полного скана мира в hot-path, если есть индексный путь.

3. При изменении UI:
- следовать `standarts.md`,
- использовать `CustomSelect` вместо нативного `select` в новых/обновляемых местах,
- учитывать mobile+desktop и состояния `loading/empty/error/success`.

4. При изменении API/WS:
- сохранить стабильные error-code,
- синхронно обновить shared/server/client.

## 10) Процесс работы агента (обязательный)
После каждого заметного этапа:
1. Обновить `AI_NOTES.md`:
- что сделано,
- почему,
- риски/ограничения,
- как проверить (конкретные шаги).

2. Обновить `README.md`, если изменились:
- запуск,
- архитектура,
- протокол,
- пользовательский флоу.

3. Обновить `CHANGELOG.md` (русский язык).

4. Прогнать `npm run typecheck -ws` и зафиксировать результат.

## 11) Быстрый чек-лист перед завершением задачи
1. Контракты shared/server/client синхронны.
2. Дельты применяются без рассинхрона версий.
3. Нет регрессии в turn-resolve и ключевых действиях (колонизация/стройка/рынок/population).
4. Документация (`AI_NOTES`, `README`, `CHANGELOG`) актуализирована.
5. Typecheck workspace проходит.

## 12) Особенности этого репозитория
- Нет полноценного набора автотестов: основной минимальный gate сейчас `typecheck` + ручные сценарии.
- `apps/server/src/index.ts` очень большой: перед правками лучше локализовать участок через `rg` по endpoint/function.
- На Windows есть фикс для `esbuild` (`scripts/fix-esbuild.cjs`, вызывается в `postinstall`).
- `.gitignore` не исключает `uploads` и некоторые data-файлы, поэтому агент должен особенно внимательно проверять `git status` перед коммитом.

## 13) Рекомендуемый рабочий паттерн агента
1. Прочитать `README` + `standarts` + `AI_NOTES`.
2. Через `rg` найти конкретный серверный endpoint/функцию и связанные client-api/store места.
3. Внести минимально достаточные изменения.
4. Прогнать `npm run typecheck -ws`.
5. Обновить `AI_NOTES`/`README`/`CHANGELOG`.
6. Проверить `git status` на случайные изменения в данных/ассетах.

## 14) Правило `спрос`
- Если в пользовательском промпте присутствует слово `спрос`, агент обязан:
  - сначала объяснить, как он понял задачу;
  - затем дождаться подтверждения пользователя;
  - и только после подтверждения приступать к реализации (или учитывать дополнительные инструкции пользователя).

---
Если правила из этого файла конфликтуют с `standarts.md`, приоритет у `standarts.md`.
