---
name: commit-push
description: Use when the user says "комить и пуш" (or "commit and push"). Updates Blueprint docs for the changes made, then commits and pushes straight to master.
---

# Комить и пуш

1. `git status --short` и `git diff --stat` — что изменилось. Не читать весь дифф, если хватает списка файлов; смотреть только неочевидные места.
2. **Обновить Blueprint** под эти изменения, точечно:
   - документ, который описывает изменённую часть (`04-draft-engine.md`, `05-evaluation-engine.md`, `06-battle-engine.md`, `03-data-model.md`, `13-deploy.md` и т. д.);
   - `10-tech-debt-backlog.md` — если долг закрыт или появился новый;
   - `12-next-session-priorities.md` — верхний блок «что сейчас», если сдвинулись приоритеты;
   - активный план (например `15-dev-plan-2026-10.md`) — журнал/статус задачи, если работа шла по нему.
     Старое не удалять без причины; `14-analytical-handoff.md` — снимок, не трогать. Если менять в Blueprint нечего — сказать об этом в отчёте.
3. Проверки по затронутым частям: `npm run lint`, typecheck затронутого workspace, тесты затронутых модулей. Красное — не коммитить, сообщить.
4. Убедиться, что защищённые файлы (`server/data/axis-weights.json`, `battle-diff-inputs.json`, `hero-meta.json`, `calibration-tags.ts`, `custom-tags.ts`, `battle-shadow.ts`) не в диффе без явного «ок» автора.
5. `git add` нужных файлов (без `.env`, `artifacts/`, мусора) → один коммит на `master`: одно английское предложение в повелительном наклонении «что и зачем» + трейлеры окружения.
6. `git push origin master`. Никаких веток и PR. При сетевой ошибке — до 4 повторов с паузой 2/4/8/16 с.
7. Отчёт: хэш коммита, что обновлено в Blueprint.
