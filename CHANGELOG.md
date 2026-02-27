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

### Удалено
- Legacy-путь полного WS-синка мира (`WORLD_PATCH` / `WORLD_BASE_SYNC`).

## [0.1.0] - Initial

### Добавлено
- Структура монорепо с пакетами client/server/shared.
- Базовый WEGO-цикл ходов, auth, управление странами, карта/провинции/колонизация.
