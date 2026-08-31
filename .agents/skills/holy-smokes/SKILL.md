---
name: Holy Smokes UI Testing
description: How to run and test the Holy Smokes BBQ portal locally in a Devin session.
---

# Holy Smokes UI Testing

## Devin Secrets Needed
- `JWT_SECRET` (any non-empty string works for local testing, e.g. `JWT_SECRET=test`)

## Starting the backend
The app is a FastAPI backend with bundled Jinja-free HTML/JS static files.
Run from the `backend` directory so the relative SQLite path resolves:

```bash
cd /home/ubuntu/repos/Holy-Smokes/backend
JWT_SECRET=test python3 -m uvicorn main:app --reload --port 8000
```

Port 8000 may already be in use if a previous session left `uvicorn` running. If so, find the process with `ps aux | grep uvicorn` and kill it before restarting.

## Test fixtures
The SQLite DB is at `backend/data/holysmokes.db` and persists across sessions. Common test users are in the task description; verify/correct their `team_number` with `sqlite3` before testing, because stale fixtures are a frequent source of misleading test failures.

## Browser testing notes
- The app uses session cookies, so open Chrome at `http://localhost:8000` and use the form login.
- Left-sidebar coordinates are unreliable because nav item count changes per role (owner, manager, regular user). For navigation, prefer the browser console or address bar over precise click coordinates to avoid misclicking links.
- The login form has IDs `email` and `password`; setting them via the browser console and calling `document.getElementById('login-form').requestSubmit()` is a reliable way to switch users when native typing is flaky.
- Tiny UI targets such as the task completion checkbox may not register with `left_click` coordinates in the test harness. As a fallback, trigger the element's click handler from the console, e.g. `document.querySelector('#tasks input[type="checkbox"]').click()`, and verify the UI state change rather than treating a missed click as a bug.
