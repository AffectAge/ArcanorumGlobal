# Журнал изменений

Все значимые изменения проекта фиксируются в этом файле.

Формат основан на Keep a Changelog, версионирование — Semantic Versioning.

## [Unreleased]

### Добавлено
- Документ `STATE_SYNC_OPTIMIZATION_PLAN.md` с roadmap оптимизации обмена состояния клиент↔сервер (envelope/versioning, range ACK, coalescing, entity-дельты, метрики/SLO).
- Механика добычи ресурсов провинции зданиями в серверном экономическом тике:
  - настройки здания `extractionGoodId`, `extractionAmountPerTurn`, `extractionRequiresDeposit`,
  - уменьшение `provinceResourceDepositsByProvince` при добыче,
  - `BuildingInstance.lastExtractionByGoodId` для диагностики добытого объема.
- UI-настройки добычи в админ-панели контента (`ContentPanel`) для категории `Здания`.

### Изменено
- WS-авторизация поддерживает resume-path: клиент передает `lastKnownWorldStateVersion`, а сервер при доступном replay отправляет `AUTH_OK` без полного `worldBase` и догоняющие `WORLD_DELTA`; при недоступном replay сохраняется fallback на полный snapshot-bootstrap.
- Клиентская обработка `WORLD_DELTA` стала идемпотентной: дубликаты/устаревшие дельты (`version <= current`) больше не триггерят replay и не применяются повторно; replay запрашивается только при реальной дырке версий.
- Контракты и серверная нормализация инстансов зданий расширены полем `lastExtractionByGoodId`.
- README обновлен описанием механики добычи зданий из залежей провинции.

## [0.1.0] - Initial

### Добавлено
- Структура монорепо с пакетами client/server/shared.
- Базовый WEGO-цикл ходов, auth, управление странами, карта/провинции/колонизация.
