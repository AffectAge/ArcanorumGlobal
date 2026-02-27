# Изменения — Этап 6: документация и версионирование изменений

## Что сделано
- Обновлен `README.md` под текущее состояние проекта:
  - стек БД исправлен на `SQLite + Prisma`;
  - шаги подготовки актуализированы (`prisma:push`);
  - WEGO-поток обновлен с `WORLD_DELTA` вместо `WORLD_PATCH`;
  - добавлен раздел про синхронизацию (`AUTH_OK` snapshot, `WORLD_DELTA`, ACK/REPLAY, snapshot fallback);
  - добавлены admin endpoint'ы диагностики (`ws-delta-metrics`, `world-delta-log/status`).
- Создан `CHANGELOG.md` (формат Keep a Changelog):
  - секция `Unreleased` с изменениями этапов 1-5;
  - зафиксированы Added/Changed/Removed;
  - добавлена базовая секция `0.1.0`.
- Зафиксировано правило процесса: при изменениях, влияющих на поведение/контракты/запуск, обновляется `README.md`; изменения по этапам отражаются в `CHANGELOG.md`.

## Почему так
- README должен отражать фактическую архитектуру и команды запуска, иначе onboarding и проверка будут расходиться с реальностью.
- CHANGELOG дает прозрачную историю изменений по версиям и упрощает релизный контроль.

## Риски / ограничения
- Если изменения в коде не сопровождать обновлением документации, README/CHANGELOG снова устареют.
- Пока используется одна секция `Unreleased`; для релизов нужно вручную переносить записи в tagged версии.

## Как проверить
1) Проверка README (как сделать):
- Открой `README.md`.
- Убедись, что:
  - в стеке указан `SQLite + Prisma`;
  - в подготовке есть `npm run prisma:push -w @arcanorum/server`;
  - в WEGO-потоке указан `WORLD_DELTA`;
  - есть разделы `Синхронизация мира` и `Админ-диагностика`.

2) Проверка CHANGELOG (как сделать):
- Открой `CHANGELOG.md`.
- Убедись, что есть:
  - `## [Unreleased]` с Added/Changed/Removed;
  - запись о `WORLD_DELTA`, ACK/REPLAY, snapshot-resync и метриках;
  - секция `## [0.1.0] - Initial`.

3) Проверка согласованности с кодом (как сделать):
- Сверь упомянутые endpoint'ы README с сервером:
  - `GET /admin/ws-delta-metrics`
  - `POST /admin/ws-delta-metrics/reset`
  - `GET /admin/world-delta-log/status`
  - `GET /world/snapshot`
- При необходимости выполни `npm run typecheck -ws` для базовой валидации актуальности проекта.
