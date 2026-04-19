# Журнал изменений

Все значимые изменения проекта фиксируются в этом файле.

Формат основан на Keep a Changelog, версионирование — Semantic Versioning.

## [Unreleased]

### Добавлено
- Механика добычи ресурсов провинции зданиями в серверном экономическом тике:
  - настройки здания `extractionGoodId`, `extractionAmountPerTurn`, `extractionRequiresDeposit`,
  - уменьшение `provinceResourceDepositsByProvince` при добыче,
  - `BuildingInstance.lastExtractionByGoodId` для диагностики добытого объема.
- UI-настройки добычи в админ-панели контента (`ContentPanel`) для категории `Здания`.

### Изменено
- Контракты и серверная нормализация инстансов зданий расширены полем `lastExtractionByGoodId`.
- README обновлен описанием механики добычи зданий из залежей провинции.

## [0.1.0] - Initial

### Добавлено
- Структура монорепо с пакетами client/server/shared.
- Базовый WEGO-цикл ходов, auth, управление странами, карта/провинции/колонизация.
