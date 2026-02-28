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

# Изменения — Этап 19: базовая механика населения (POP) + UI/админ-управление

## Что сделано
- Добавлена базовая серверная модель населения в `gameSettings.population.pops`.
- Для каждого POP зафиксирован контракт:
  - `id`,
  - `countryId`,
  - `provinceId`,
  - `size`,
  - `cultureId`,
  - `religionId`,
  - `raceId`,
  - `createdAt`, `updatedAt`.
- Добавлены серверные API:
  - `GET /population/pops` (авторизованный просмотр),
  - `GET /population/summary` (сводка),
  - `GET /admin/population/pops` (админ-просмотр),
  - `POST /admin/population/pops` (создание POP),
  - `PATCH /admin/population/pops/:popId` (редактирование POP),
  - `DELETE /admin/population/pops/:popId` (удаление POP),
  - `POST /admin/population/generate` (массовая генерация).
- Добавлены серверные инкрементальные индексы населения (оптимизация read-path):
  - `populationById`,
  - `populationPopIdsByCountry`,
  - `populationPopIdsByProvince`,
  - `populationTotalSizeByCountry`.
- Добавлена проверка целостности справочников:
  - нельзя удалить `culture/religion/race`, если ID используется хотя бы в одном POP (`CONTENT_IN_USE_BY_POPULATION`).
- Клиент:
  - добавлена модалка `PopulationModal` в стилистике контент-панели,
  - открытие по кнопке `Население` в левой панели (`SideNav`),
  - в админ-панели добавлена категория `Управление населением` (генерация + сводка + переход в полную панель).
- Обновлены общие типы `packages/shared`:
  - `PopulationPop`,
  - `PopulationCountrySummary`.
- Обновлен клиентский API-слой (`apps/client/src/lib/api.ts`) под новые population-endpoint'ы.

## Почему так
- Нужна базовая механика POP с атрибутами `культура/религия/раса` и возможностью оперативного админ-управления.
- Для соответствия требованиям по производительности добавлены индексные read-path'и вместо постоянного full-scan по всему массиву POP.
- Хранение через уже существующий механизм `gameSettings` и `savePersistentState` позволило обойти отдельную тяжелую миграцию БД и сохранить текущий процесс персистентности.

## Риски / ограничения
- Сейчас population хранится в `gameSettings` как единый массив; при очень больших объемах данных может потребоваться вынос в отдельную таблицу/шардирование.
- `GET /population/pops` использует лимит на клиенте; для крупных сценариев рекомендуется развивать пагинацию и/или серверные фильтры в UI по умолчанию.
- Генерация использует псевдослучайное распределение по пулам стран/провинций/контента; это базовый режим, не демографическая модель.

## Как проверить
1) Типизация workspace (как сделать):
- Выполнить `npm run typecheck`.
- Ожидаемо: без ошибок в client/server/shared.

2) UI-кнопка населения (как сделать):
- Запустить `npm run dev`.
- Авторизоваться любым игроком.
- Нажать в левой панели `Население`.
- Ожидаемо: открывается модалка населения, видны список POP и сводка по странам.

3) Админ-генерация (как сделать):
- Войти под админом.
- Открыть `Панель администратора` -> `Управление населением`.
- Задать `Количество/Min/Max` и нажать `Сгенерировать население`.
- Ожидаемо: увеличивается `Всего POP`, обновляется сводка по странам.

4) Полное управление POP (как сделать):
- Из `Управление населением` нажать `Открыть полное управление`.
- В модалке населения:
  - выбрать POP,
  - изменить культуру/религию/расу/размер,
  - сохранить,
  - удалить выбранный POP,
  - создать новый POP.
- Ожидаемо: изменения применяются и сохраняются между перезапусками.

5) Проверка целостности справочников (как сделать):
- Создать POP, ссылающийся на конкретную культуру/религию/расу.
- В `Панели контента` попытаться удалить этот элемент.
- Ожидаемо: отказ с сообщением, что запись используется населением.
