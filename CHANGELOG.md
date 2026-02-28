# Журнал изменений

Все значимые изменения проекта фиксируются в этом файле.

Формат основан на Keep a Changelog, версионирование — Semantic Versioning.

## [Unreleased]

### Добавлено
- Повышение надежности WS-дельт: `WORLD_DELTA_ACK` и `WORLD_DELTA_REPLAY_REQUEST`.
- Endpoint мягкого ресинка: `GET /world/snapshot`.
- Админские endpoint'ы метрик: `GET /admin/ws-delta-metrics`, `POST /admin/ws-delta-metrics/reset`.
- Endpoint статуса персистентного журнала дельт: `GET /admin/world-delta-log/status`.
- Персистентный журнал дельт в БД (`WorldDeltaLog`) с восстановлением replay после рестарта сервера.
- Процесс ведения `AI_NOTES.md` с заметками по реализации и проверке.

### Изменено
- Полный WS-синк мира заменен на компактные обновления `WORLD_DELTA`.
- Добавлен поток `worldStateVersion` для упорядоченного применения состояния.
- Сжат payload WS-дельт (`mask` + короткие ключи `c/o/n/p/z`) для уменьшения размера сообщений.
- Стратегия синхронизации клиента: сначала replay, затем fallback на snapshot-resync.
- `README.md` обновлен под текущую архитектуру WS-синхронизации и SQLite.
- `savePersistentState` переведен на debounce-запись с принудительным flush в критичной точке резолва хода.
- Prune журнала `WorldDeltaLog` вынесен из hot-path вставки в периодическую задачу.
- `GET /admin/provinces` получил опциональную пагинацию (`limit`, `offset`) и метаданные (`total`).
- Клиентский таймер ожидания автоперехода хода переведен с polling `setInterval` на одноразовый `setTimeout`.
- Добавлен короткий in-memory TTL-кэш для частых `country.findMany` запросов с инвалидацией на мутациях страны.
- WS broadcast ограничен авторизованными сокетами; `NEWS_EVENT` с `private` visibility отправляются только целевой стране и администраторам.
- Убран `JSON.stringify` из сравнения `colonyProgressByProvince` в diff-пайплайне `WORLD_DELTA` (заменен на структурный compare map-данных).
- Введен индекс активных колонизаций (`country -> provinces`) и инкрементальный resolve-проход по touched провинциям вместо полного сканирования прогресса.
- `MapView` переведен с подписки на весь `worldBase` на точечные селекторы Zustand по веткам карты (`provinceOwner`, `provinceNameById`, `colonyProgressByProvince`, `provinceColonizationByProvince`) для снижения лишних ререндеров клиента.
- Исправлено залипание overlay "Идет обработка хода" при входе: авто-таймер теперь отправляет `REQUEST_RESOLVE` без локального принудительного `processing`, добавлен guard от повторных авто-запросов в одном ходу, overlay сбрасывается в `idle` при `AUTH_OK` и logout.
- Добавлен таймаут-защитник ожидания `TURN_RESOLVE_STARTED` после `REQUEST_RESOLVE`: при отсутствии подтверждения за 12 секунд показывается неблокирующее предупреждение вместо залипания блокирующего overlay; аналогичное server-confirmed поведение применено и к ручному запуску резолва.
- Добавлены инкрементальные индексы очереди приказов по ходам (`COLONIZE`/`BUILD`) и индекс стран экономического тика; проверки лимитов/дубликатов `COLONIZE` переведены с полного обхода `turnOrders` на индексный путь, а начисление базовой экономики в `resolveTurn` — с полного прохода `resourcesByCountry` на индекс `economyTickCountryIds`.
- Добавлен единый стандарт проекта `standarts.md` с правилами по UI, механикам, производительности, API/WS-контрактам, тестированию и процессу разработки (включая обязательные правила ведения `AI_NOTES.md`, `README.md`, `CHANGELOG.md`).
- В `standarts.md` добавлен раздел цветовой системы: зафиксированы токены UI (`arc.*`), статусные цвета, палитра режимов карты, легенда колонизации и правила расширения палитры.
- Full snapshot `worldBase` в дельта-пайплайне заменен на partial snapshot по dirty-sections (`mask`): сервер теперь копирует только изменяемые ветки перед diff (`c/o/n/p/z`), что снижает CPU/GC нагрузку в hot-path (`resolveTurn`, колонизация, rename, админ-операции).

### Удалено
- Legacy-путь полного WS-синка мира (`WORLD_PATCH` / `WORLD_BASE_SYNC`).

## [0.1.0] - Initial

### Добавлено
- Структура монорепо с пакетами client/server/shared.
- Базовый WEGO-цикл ходов, auth, управление странами, карта/провинции/колонизация.
