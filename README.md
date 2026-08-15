# Holy Smokes BBQ Team Platform

A minimalist team management app for the Holy Smokes high school BBQ team.

## Features

- Email/password login restricted to `@dccs.org` accounts
- Onboarding flow for first-time users (name, nickname, DC email, phone, profile picture, password)
- Dashboard with motivational quote, completed tasks, and recent announcements
- Real-time team chat and manager-only chat
- Task list with manager assignment
- Manager-only page for task assignment, announcements, and chat
- Team roster page with names and emails
- Owner-only admin panel to promote/demote managers
- Emergency contact page
- Settings page to edit profile and change password

## Tech Stack

- Backend: Python + FastAPI + SQLite
- Frontend: HTML, Tailwind CSS, vanilla JavaScript
- Auth: Email/password with JWT sessions

## Local Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Install dependencies and run:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

3. Open `http://localhost:8000` to see the public website, or go to `http://localhost:8000/login` to create an account with a `@dccs.org` email.

The first registered user automatically becomes the owner and a manager.

## Manager Access

Owners can promote or demote managers from the **Admin** page. The first user to register is automatically the owner.

You can also pre-assign an owner email before anyone registers:

```env
OWNER_EMAIL=coach@dccs.org
```

## Deployment

### Railway

1. Create a new Railway project and connect your `ashykxees/Holy-Smokes` GitHub repo.
2. In the service settings, add these environment variables:
   - `JWT_SECRET` (required — generate a long random string)
   - `OWNER_EMAIL` (optional — makes that user an owner/manager on registration)
   - `SECURE_COOKIES` (optional — set to `true` only if every connection uses HTTPS)
3. Create a volume and mount it to `/app/data` so the SQLite database persists.
4. Deploy. Railway will build from the `Dockerfile` and start the app.
5. After it is live, add your custom domain in Railway under **Settings → Domains** and update your DNS records as instructed.

The first user to register with a `@dccs.org` email becomes the owner and a manager.

### Other hosts

Set environment variables on your host:

- `JWT_SECRET` (required, a long random string)
- `OWNER_EMAIL` (optional, makes that user an owner/manager on registration)
- `MANAGER_SETUP_SECRET` (optional, legacy self-promotion secret)
- `SECURE_COOKIES` (optional — set to `true` only if every connection uses HTTPS)
- `DATABASE_PATH` (optional, defaults to `data/holysmokes.db` locally)

Run with `uvicorn main:app --host 0.0.0.0 --port 8000` from the `backend` directory.
