# План оптимизации обмена state между клиентом и сервером

Документ фиксирует практический roadmap для текущей архитектуры Arcanorum (authoritative server + snapshot + `WORLD_DELTA` + ACK/REPLAY).

## 0) Текущее состояние (как база)

- Контракт уже использует компактный патч-формат через `mask` и short-keys (`c/o/n/...`), что снижает размер пакета относительно baseline.  
- Уже есть механизм консистентности: `worldStateVersion`, `WORLD_DELTA_ACK`, `WORLD_DELTA_REPLAY_REQUEST`, fallback на `GET /world/snapshot`.  
- Есть серверная диагностика по экономии размера дельт и глубине replay-логов.

Это хорошая база: дальше стоит усиливать **delivery-гарантии, адаптивность и наблюдаемость**.

---

## 1) Приоритет P0 — reliability + стандарты протокола

### 1.1 Ввести явный envelope и `schemaVersion`

Что сделать:
- Добавить общий envelope у всех WS-сообщений: `protocolVersion`, `schemaVersion`, `messageId`, `sentAtMs`.
- Для `WORLD_DELTA` добавить `deltaId` (монотонный в рамках `worldStateVersion`) и `source` (`live`/`replay`).

Зачем:
- Упрощает кросс-версионную совместимость клиента/сервера.
- Даёт стабильную основу для telemetry и дедупликации сообщений.

### 1.2 ACK как диапазоны (range ack)

Что сделать:
- Вместо одного `WORLD_DELTA_ACK` версии поддержать `ackedUpTo` + необязательный массив `holes`.
- Сервер хранит per-socket `ackedUpTo`, умеет реплейить только “дырки”.

Зачем:
- Это стандартный подход у надёжных потоковых протоколов.
- Существенно снижает лишний replay после временных сетевых глитчей.

### 1.3 Идемпотентность применения на клиенте

Что сделать:
- На клиенте добавить guard: если `delta.worldStateVersion <= currentWorldStateVersion`, дельту не применять повторно (только ack/лог).

Зачем:
- Устраняет двойное применение в edge-case с повторной доставкой.

---

## 2) Приоритет P1 — уменьшение трафика без потери модели

### 2.1 Двухуровневые дельты: section-delta + entity-delta

Что сделать:
- Сохранить текущий section-level формат (`u`, `b`, ...), но добавить внутри секций тонкие операции:
  - `set`, `unset`, `merge`, `append`, `removeById`.
- Для “тяжёлых” секций (`provincePopulationByProvince`, `provinceBuildingsByProvince`) избегать пересылки целого объекта/массива, если изменился 1 элемент.

Зачем:
- Это главная экономия в реальных игровых тиках.

### 2.2 Batch + coalescing по окну 30–80мс

Что сделать:
- На сервере объединять несколько быстрых локальных мутаций в 1 outbound-дельту по небольшому окну (конфиг через env).

Зачем:
- Меньше WS-фреймов, меньше накладных расходов и ререндеров.

### 2.3 Компрессия канала

Что сделать:
- Для WebSocket включить `permessage-deflate` с ограничением уровня/памяти.
- Для snapshot endpoint (`/world/snapshot`) убедиться, что HTTP compression включён.

Зачем:
- На больших payload это обычно даёт заметную экономию сети.

---

## 3) Приоритет P1 — оптимизация клиентского state-management

### 3.1 Нормализация store + стабильные ссылки

Что сделать:
- В Zustand хранить крупные разделы в normalized-структурах (особенно массивы зданий/очередей).
- При `applyWorldDelta` менять только реально изменившиеся ветки и сохранять referential stability остальных.

Зачем:
- Снижает количество React-rerender и GC pressure.

### 3.2 Применение дельт через очередь и `startTransition`

Что сделать:
- Добавить внутреннюю очередь входящих `WORLD_DELTA` (с последовательным drain).
- UI-обновления не критичные к latency проводить в `startTransition`.

Зачем:
- Меньше фризов UI на burst-сценариях.

---

## 4) Приоритет P2 — observability и SLO

### 4.1 Новые метрики (сервер + клиент)

Сервер:
- `delta_build_ms`, `delta_compact_bytes`, `delta_replay_count`, `replay_gap_size`, `snapshot_resync_count`.

Клиент:
- `delta_apply_ms`, `delta_queue_depth`, `render_commit_ms_after_delta`, `resync_reason`.

### 4.2 Цели качества (SLO)

Рекомендуемые стартовые SLO:
- P95 `delta_apply_ms` < 16ms на target железе.
- `snapshot_resync_rate` < 0.5% от активных WS-сессий.
- P95 размер live-дельты < 32KB (после компрессии — ещё ниже).

---

## 5) Минимальный безопасный rollout

1. `schemaVersion` + envelope + идемпотентный apply (без смены формата данных).  
2. Range ACK + улучшенный replay.  
3. Batch/coalescing.  
4. Тонкие entity-дельты для 1–2 самых тяжёлых секций.  
5. Метрики и алерты по SLO.

Каждый шаг выпускать за feature-flag и с dual-write логикой (старый + новый формат) на переходный период.

---

## 6) Что НЕ делать сейчас

- Не переходить сразу на полный event sourcing или CRDT: для authoritative WEGO это избыточно на текущем этапе.
- Не вводить полную замену протокола (например, gRPC-streaming) до того, как исчерпан потенциал текущей WS-модели.

---

## 7) Быстрые win-задачи (1–2 спринта)

1. Идемпотентный apply на клиенте.  
2. Range ACK с backward-compatible обработкой старого ACK.  
3. Coalescing серверных дельт (конфиг 50мс).  
4. Панель метрик: `snapshot_resync_rate`, `replay_gap_size`, `delta_apply_ms`.

Ожидаемый результат: меньше ресинков, меньше jitter по UI и стабильнее latency на массовых ходах.
