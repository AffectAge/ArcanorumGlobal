# Изменения — Этап 18: убрать full-snapshot `cloneWorldBaseSnapshot` из hot-path через partial snapshot/dirty sections

## Что сделано
- Удален путь полного snapshot мира (`structuredClone({...worldBase})`) перед расчетом дельт.
- Добавлен новый partial snapshot-механизм:
  - `cloneWorldBaseSectionSnapshot(mask)` — клонирует только нужные ветки по маске,
  - `toWorldBaseForDeltaDiff(...)` — собирает prev-view для diff из snapshot + текущего состояния,
  - `broadcastWorldDeltaFromSectionSnapshot(...)` — отправка дельт из section snapshot.
- `resolveTurn` переведен на section snapshot с маской:
  - `resourcesByCountry`,
  - `provinceOwner`,
  - `colonyProgressByProvince`.
- Все hot-path endpoint'ы, где раньше брали full snapshot, переведены на целевые маски:
  - `/country/colonization/start` -> `colonyProgressByProvince`,
  - `/country/colonization/cancel` -> `colonyProgressByProvince`,
  - `/country/province-rename` -> `resourcesByCountry + provinceNameById`,
  - `/admin/provinces/:provinceId` -> `resourcesByCountry + provinceOwner + colonyProgressByProvince + provinceColonizationByProvince`,
  - `/admin/provinces/recalculate-auto-costs` -> `provinceColonizationByProvince`,
  - `/admin/countries/:countryId` delete -> `resourcesByCountry + provinceOwner + colonyProgressByProvince`,
  - `/admin/registrations/:countryId/review` (reject) -> `resourcesByCountry + provinceOwner + colonyProgressByProvince`,
  - `/admin/game-settings` (колонизационный блок) -> `provinceColonizationByProvince`.

## Почему так
- Full snapshot копировал весь `worldBase` даже когда менялась одна ветка, что давало лишнюю CPU/GC нагрузку при росте данных и онлайна.
- Partial snapshot режет объем копирования до реально изменяемых секций, сохраняя текущий протокол и механику diff.

## Риски / ограничения
- Корректность зависит от правильности `dirty mask` в каждом месте мутаций.
- Если в будущем добавить новую мутацию и забыть включить нужный бит в маску, можно потерять часть дельты.
- Нужна дисциплина: маска должна соответствовать фактическим изменениям состояния.

## Как проверить
1) Сборка/типизация (как сделать):
- Выполни `npm run typecheck -ws`.
- Ожидаемо: без ошибок.

2) Проверка ключевых сценариев дельт (как сделать):
- Запусти `npm run dev`.
- Выполни:
  - старт/отмена колонизации,
  - переименование провинции,
  - админ-изменение провинции (owner/cost/disable),
  - удаление страны.
- Ожидаемо: `WORLD_DELTA` приходит с корректными секциями (`c/o/n/p/z`) без регрессий поведения.

3) Проверка резолва хода (как сделать):
- Отправь набор BUILD/COLONIZE и завершите ход.
- Ожидаемо: корректные списания/начисления ресурсов, захват провинций и `rejectedOrders`.

4) Проверка производительности (как сделать):
- На локальном профиле сравни время резолва/нагрузку GC до и после на одинаковом сценарии.
- Ожидаемо: снижение стоимости snapshot-фазы при частых мутациях малой части `worldBase`.
