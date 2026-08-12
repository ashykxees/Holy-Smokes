# Holy Smokes BBQ Team Platform

A minimalist team management app for the Holy Smokes high school BBQ team.

## Features

- Google Login restricted to `@dccs.org` accounts
- Onboarding flow for first-time users (name, nickname, phone, profile picture)
- Dashboard with motivational quote, completed tasks, and recent announcements
- Real-time team chat and manager-only chat
- Task list with manager assignment
- Manager-only page for task assignment, announcements, and chat
- Emergency contact page
- Settings page to edit profile and become a manager

## Tech Stack

- Backend: Python + FastAPI + SQLite
- Frontend: HTML, Tailwind CSS, vanilla JavaScript
- Auth: Google Sign-In (OAuth 2.0 ID tokens)

## Local Setup

1. Copy the example environment file and fill in your Google OAuth client ID:

```bash
cp .env.example .env
```

2. Create a Google OAuth 2.0 Web application credential at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add `http://localhost:8000` (and your production domain) to Authorized JavaScript origins.

3. Install dependencies and run:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

4. Open `http://localhost:8000` and sign in with a `@dccs.org` account.

## Manager Access

Set the `MANAGER_EMAILS` environment variable with a comma-separated list of manager emails:

```env
MANAGER_EMAILS=griffin@dccs.org,coach@dccs.org
```

Alternatively, any signed-in user can promote themselves by going to **Settings** and entering the `MANAGER_SETUP_SECRET`.

## Deployment

Set environment variables on your host:

- `GOOGLE_CLIENT_ID`
- `JWT_SECRET`
- `MANAGER_EMAILS` (optional)
- `MANAGER_SETUP_SECRET` (optional)
- `SECURE_COOKIES=true` in production
- `DATABASE_PATH` (optional, defaults to `data/holysmokes.db`)

Run with `uvicorn main:app --host 0.0.0.0 --port 8000` from the `backend` directory.
