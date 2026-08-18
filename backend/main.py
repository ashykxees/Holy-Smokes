import os
import json
import re
import html
import base64
import asyncio
import urllib.request
import urllib.error
from urllib.parse import urlencode
from contextlib import asynccontextmanager
from email.message import EmailMessage

import aiosmtplib

import aiosqlite
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException, status, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
load_dotenv()

try:
    from . import database as db
    from .auth import (
        create_session_token,
        get_current_user,
        get_current_user_pending,
        get_ws_user_from_cookie,
        is_dccs_email,
        hash_password,
        require_manager,
        require_owner,
        verify_password,
    )
except ImportError:
    import database as db
    from auth import (
        create_session_token,
        get_current_user,
        get_current_user_pending,
        get_ws_user_from_cookie,
        is_dccs_email,
        hash_password,
        require_manager,
        require_owner,
        verify_password,
    )

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
MAX_PICTURE_SIZE = 2 * 1024 * 1024  # 2 MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    app.state.connections = {"general": [], "manager": []}
    yield


app = FastAPI(title="Holy Smokes BBQ Team", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")


def _is_https_request(request: Request) -> bool:
    env_setting = os.environ.get("SECURE_COOKIES", "").lower()
    if env_setting in ("true", "1"):
        return True
    if env_setting in ("false", "0"):
        return False
    # Default to non-secure cookies so the app works on both HTTP and HTTPS.
    # Set SECURE_COOKIES=true when you are sure every connection uses HTTPS.
    return False


def _set_session_cookie(response: JSONResponse, user: dict, request: Request) -> JSONResponse:
    token = create_session_token(user)
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        secure=_is_https_request(request),
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return response


@app.get("/api/config")
async def api_config():
    return {"auth": "email"}


@app.get("/health")
async def health():
    return {"ok": True}


def _display_name(profile: dict) -> str:
    if profile.get("nickname"):
        return profile["nickname"].strip()
    parts = [profile.get("first_name", "").strip(), profile.get("last_name", "").strip()]
    return " ".join(p for p in parts if p) or profile.get("email", "").split("@")[0]


@app.post("/api/auth/register")
async def auth_register(request: Request):
    data = await request.json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    confirm_password = data.get("confirm_password", "")

    if not email or not is_dccs_email(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="A valid @dccs.org email is required")
    if len(password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")
    if password != confirm_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Passwords do not match")

    profile = _validate_profile(data, require_complete=True)

    database = await db.get_db()
    cursor = await database.execute("SELECT COUNT(*) as count FROM users")
    count = (await cursor.fetchone())["count"]

    cursor = await database.execute("SELECT email FROM users WHERE email = ?", (email,))
    if await cursor.fetchone():
        await database.close()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="An account with this email already exists")

    is_owner = count == 0
    is_manager = is_owner or bool(os.environ.get("OWNER_EMAIL", "").lower() == email)
    is_approved = is_owner or is_manager

    await database.execute(
        """INSERT INTO users (
               email, dc_email, password_hash, name, first_name, last_name, nickname,
               phone, is_dc_employee, picture, is_manager, is_owner, is_approved, onboarding_completed, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
        (
            email,
            profile["dc_email"],
            hash_password(password),
            profile["name"],
            profile["first_name"],
            profile["last_name"],
            profile["nickname"],
            profile["phone"],
            int(profile["is_dc_employee"]),
            profile["picture"],
            int(is_manager),
            int(is_owner),
            int(is_approved),
            db.now_iso(),
        ),
    )
    await database.commit()
    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, is_owner, is_approved, onboarding_completed
           FROM users WHERE email = ?""",
        (email,),
    )
    row = await cursor.fetchone()
    await database.close()
    user = dict(row)
    response = JSONResponse(user)
    return _set_session_cookie(response, user, request)


@app.post("/api/auth/login")
async def auth_login(request: Request):
    data = await request.json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not is_dccs_email(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="A valid @dccs.org email is required")

    database = await db.get_db()
    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, is_owner, is_approved, onboarding_completed, password_hash
           FROM users WHERE email = ?""",
        (email,),
    )
    row = await cursor.fetchone()
    await database.close()
    if not row or not row["password_hash"] or not verify_password(password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user = dict(row)
    user.pop("password_hash", None)
    response = JSONResponse(user)
    return _set_session_cookie(response, user, request)


@app.post("/api/logout")
async def logout(request: Request):
    response = JSONResponse({"ok": True})
    response.delete_cookie(
        "session",
        path="/",
        secure=_is_https_request(request),
        samesite="lax",
    )
    return response


@app.get("/api/me")
async def me(user: dict = Depends(get_current_user_pending)):
    return user


def _validate_profile(data: dict, require_complete: bool = True) -> dict:
    first_name = data.get("first_name", "").strip()
    last_name = data.get("last_name", "").strip()
    nickname = data.get("nickname", "").strip()
    phone = data.get("phone", "").strip()
    is_dc_employee = bool(data.get("is_dc_employee", False))
    picture = data.get("picture", "").strip()
    dc_email = data.get("dc_email", "").strip().lower()
    if not dc_email:
        dc_email = data.get("email", "").strip().lower()

    if require_complete:
        if not first_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="First name is required")
        if not last_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Last name is required")
        if not is_dc_employee and not phone:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Phone number is required unless you are a DC employee")
        if not dc_email or not is_dccs_email(dc_email):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="A valid @dccs.org DC email is required")

    if phone and not re.match(r"^[\d\s\-()+\.]{7,20}$", phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Phone number looks invalid")

    if picture and picture.startswith("data:image"):
        if len(picture) > MAX_PICTURE_SIZE:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Profile picture must be under 2 MB")

    display_name = nickname or " ".join([first_name, last_name]).strip() or (dc_email.split("@")[0] if dc_email else "Team Member")
    return {
        "first_name": first_name or None,
        "last_name": last_name or None,
        "nickname": nickname or None,
        "phone": phone or None,
        "dc_email": dc_email or None,
        "is_dc_employee": is_dc_employee,
        "picture": picture or None,
        "name": display_name,
    }


@app.post("/api/profile")
async def update_profile(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    profile = _validate_profile(data, require_complete=True)

    new_password = data.get("new_password", "")
    current_password = data.get("current_password", "")
    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="New password must be at least 6 characters")
        if not user.get("password_hash") or not verify_password(current_password, user["password_hash"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    database = await db.get_db()
    values = [
        profile["name"],
        profile["first_name"],
        profile["last_name"],
        profile["nickname"],
        profile["phone"],
        profile["dc_email"],
        int(profile["is_dc_employee"]),
        profile["picture"],
    ]
    password_sql = ""
    if new_password:
        password_sql = ", password_hash = ?"
        values.append(hash_password(new_password))
    values.append(user["email"])
    await database.execute(
        f"""UPDATE users
           SET name = ?, first_name = ?, last_name = ?, nickname = ?, phone = ?,
               dc_email = ?, is_dc_employee = ?, picture = ? {password_sql}
           WHERE email = ?""",
        values,
    )
    await database.commit()

    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, is_owner, is_approved, onboarding_completed
           FROM users WHERE email = ?""",
        (user["email"],),
    )
    updated = await cursor.fetchone()
    await database.close()

    updated_user = dict(updated)
    response = JSONResponse(updated_user)
    return _set_session_cookie(response, updated_user)


@app.get("/api/users")
async def list_users(user: dict = Depends(get_current_user)):
    database = await db.get_db()
    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, picture, is_manager
           FROM users WHERE is_approved = 1 ORDER BY name"""
    )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.get("/api/tasks")
async def list_tasks(request: Request, user: dict = Depends(get_current_user)):
    database = await db.get_db()
    completed = request.query_params.get("completed")
    if completed is not None:
        completed_flag = completed.lower() in ("1", "true", "yes")
        completed_int = 1 if completed_flag else 0
        if user.get("is_manager"):
            cursor = await database.execute(
                "SELECT * FROM tasks WHERE completed = ? ORDER BY completed_at DESC, created_at DESC",
                (completed_int,),
            )
        else:
            cursor = await database.execute(
                "SELECT * FROM tasks WHERE (assigned_to = ? OR assigned_to = 'all') AND completed = ? ORDER BY completed_at DESC, created_at DESC",
                (user["email"], completed_int),
            )
    else:
        if user.get("is_manager"):
            cursor = await database.execute("SELECT * FROM tasks ORDER BY created_at DESC")
        else:
            cursor = await database.execute(
                "SELECT * FROM tasks WHERE assigned_to = ? OR assigned_to = 'all' ORDER BY created_at DESC",
                (user["email"],),
            )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.post("/api/tasks")
async def create_task(request: Request, user: dict = Depends(require_manager)):
    data = await request.json()
    title = data.get("title", "").strip()
    description = data.get("description", "").strip()
    assigned_to = data.get("assigned_to", "all").strip().lower()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Title required")
    database = await db.get_db()
    cursor = await database.execute(
        "INSERT INTO tasks (title, description, assigned_to, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        (title, description, assigned_to, user["email"], db.now_iso()),
    )
    task_id = cursor.lastrowid
    await database.commit()
    await database.close()
    return {"id": task_id, "title": title, "description": description, "assigned_to": assigned_to}


@app.patch("/api/tasks/{task_id}/complete")
async def complete_task(task_id: int, request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    completed = bool(data.get("completed", False))
    database = await db.get_db()
    cursor = await database.execute("SELECT assigned_to, completed FROM tasks WHERE id = ?", (task_id,))
    row = await cursor.fetchone()
    if not row:
        await database.close()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if row["assigned_to"] != "all" and row["assigned_to"] != user["email"] and not user.get("is_manager"):
        await database.close()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not assigned to this task")

    completed_at = db.now_iso() if completed else None
    completed_by = user["email"] if completed else None
    await database.execute(
        "UPDATE tasks SET completed = ?, completed_by = ?, completed_at = ? WHERE id = ?",
        (int(completed), completed_by, completed_at, task_id),
    )
    await database.commit()
    await database.close()
    return {"id": task_id, "completed": completed}


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, user: dict = Depends(require_manager)):
    database = await db.get_db()
    await database.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    await database.commit()
    await database.close()
    return {"ok": True}


@app.get("/api/announcements")
async def list_announcements(user: dict = Depends(get_current_user)):
    database = await db.get_db()
    cursor = await database.execute(
        "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 10"
    )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.post("/api/announcements")
async def create_announcement(request: Request, user: dict = Depends(require_manager)):
    data = await request.json()
    title = data.get("title", "").strip()
    content = data.get("content", "").strip()
    if not title or not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Title and content required")
    database = await db.get_db()
    cursor = await database.execute(
        "INSERT INTO announcements (title, content, author_email, author_name, created_at) VALUES (?, ?, ?, ?, ?)",
        (title, content, user["email"], user["name"], db.now_iso()),
    )
    ann_id = cursor.lastrowid
    await database.commit()
    await database.close()

    announcement = {
        "id": ann_id,
        "title": title,
        "content": content,
        "author_name": user["name"],
        "created_at": db.now_iso(),
    }
    await broadcast({"type": "announcement", "data": announcement}, "general")
    return announcement


@app.get("/api/chat")
async def chat_history(manager: bool = False, user: dict = Depends(get_current_user)):
    if manager and not user.get("is_manager"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Manager access required")
    database = await db.get_db()
    cursor = await database.execute(
        "SELECT * FROM chat_messages WHERE manager_chat = ? ORDER BY created_at DESC LIMIT 50",
        (int(manager),),
    )
    rows = await cursor.fetchall()
    await database.close()
    return list(reversed([dict(r) for r in rows]))


@app.get("/api/admin/users")
async def admin_list_users(user: dict = Depends(require_owner)):
    database = await db.get_db()
    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, phone,
                  is_manager, is_owner, is_approved, created_at
           FROM users ORDER BY name"""
    )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.patch("/api/admin/users/{email}/manager")
async def admin_set_manager(email: str, request: Request, user: dict = Depends(require_owner)):
    data = await request.json()
    is_manager = bool(data.get("is_manager", False))
    target_email = email.lower().strip()
    if target_email == user["email"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You cannot change your own manager status")
    database = await db.get_db()
    await database.execute(
        "UPDATE users SET is_manager = ? WHERE email = ?",
        (int(is_manager), target_email),
    )
    await database.commit()
    await database.close()
    return {"email": target_email, "is_manager": is_manager}


@app.get("/api/admin/pending")
async def admin_list_pending(user: dict = Depends(require_manager)):
    database = await db.get_db()
    cursor = await database.execute(
        """SELECT email, dc_email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, created_at
           FROM users WHERE is_approved = 0 ORDER BY created_at DESC"""
    )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.post("/api/admin/users/{email}/approve")
async def admin_approve_user(email: str, user: dict = Depends(require_manager)):
    target_email = email.lower().strip()
    if target_email == user["email"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You cannot change your own approval status")
    database = await db.get_db()
    await database.execute("UPDATE users SET is_approved = 1 WHERE email = ?", (target_email,))
    await database.commit()
    await database.close()
    return {"email": target_email, "is_approved": True}


@app.delete("/api/admin/users/{email}")
async def admin_delete_user(email: str, user: dict = Depends(require_manager)):
    target_email = email.lower().strip()
    if target_email == user["email"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")
    database = await db.get_db()
    await database.execute("DELETE FROM users WHERE email = ?", (target_email,))
    await database.commit()
    await database.close()
    return {"ok": True}


_CATERING_ALLOWED_ITEMS = {
    "Pulled Pork", "Brisket", "Ribs", "Mac n Cheese", "Special Request"
}
_CATERING_ALLOWED_EVENTS = {"Party", "Wedding", "Gathering", "Other"}


def _send_sendgrid_email_sync(api_key: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str):
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email},
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": plain_body},
            {"type": "text/html", "value": html_body},
        ],
    }
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=data_bytes,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status >= 400:
                raise Exception(f"SendGrid returned {resp.status}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise Exception(f"SendGrid error {exc.code}: {body}") from exc


async def _send_sendgrid_email(api_key: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str):
    return await asyncio.to_thread(_send_sendgrid_email_sync, api_key, from_email, to_email, subject, plain_body, html_body)


def _send_mailgun_email_sync(api_key: str, domain: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str):
    data = {
        "from": from_email,
        "to": to_email,
        "subject": subject,
        "text": plain_body,
        "html": html_body,
    }
    auth = base64.b64encode(f"api:{api_key}".encode("utf-8")).decode("utf-8")
    req = urllib.request.Request(
        f"https://api.mailgun.net/v3/{domain}/messages",
        data=urlencode(data).encode("utf-8"),
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status >= 400:
                raise Exception(f"Mailgun returned {resp.status}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise Exception(f"Mailgun error {exc.code}: {body}") from exc


async def _send_mailgun_email(api_key: str, domain: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str):
    return await asyncio.to_thread(_send_mailgun_email_sync, api_key, domain, from_email, to_email, subject, plain_body, html_body)


def _format_catering_email(data: dict) -> tuple[str, str, str]:
    safe_name = html.escape(data["name"])
    safe_phone = html.escape(data["phone"])
    safe_event = html.escape(data["event_type"])
    safe_guests = html.escape(str(data["guests"]))
    safe_date = html.escape(data["event_date"])
    safe_items = ", ".join(html.escape(i) for i in data["items"])
    safe_desc = html.escape(data.get("description", "") or "None provided")

    subject = "New Catering Request"
    html_body = f"""<html>
<body style="font-family: Montserrat, Arial, sans-serif; color: #151614;">
  <h2 style="color: #324A2A; text-transform: uppercase; letter-spacing: 0.05em;">New Catering Request</h2>
  <table style="border-collapse: collapse; max-width: 600px;">
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee;">Name</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_name}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee;">Phone</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_phone}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee;">Event Type</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_event}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee;">Expected Guests</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_guests}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee;">Event Date</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_date}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee; vertical-align: top;">Requested Items</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee;">{safe_items}</td></tr>
    <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #eee; vertical-align: top;">Description &amp; Special Requests</td><td style="padding: 8px 12px; border-bottom: 1px solid #eee; white-space: pre-wrap;">{safe_desc}</td></tr>
  </table>
  <p style="margin-top: 24px; color: #6b7280; font-size: 12px;">Submitted via holysmokes.cc</p>
</body>
</html>"""
    plain_body = f"""New Catering Request

Name: {data['name']}
Phone: {data['phone']}
Event Type: {data['event_type']}
Expected Guests: {data['guests']}
Event Date: {data['event_date']}
Requested Items: {', '.join(data['items'])}
Description & Special Requests:
{data.get('description', 'None provided')}

Submitted via holysmokes.cc
"""
    return subject, html_body, plain_body


@app.post("/api/catering")
async def catering_request(request: Request):
    data = await request.json()
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    event_type = (data.get("event_type") or "").strip()
    guests_raw = data.get("guests")
    event_date = (data.get("event_date") or "").strip()
    items = data.get("items") or []
    description = (data.get("description") or "").strip()

    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Name is required")
    if not phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Phone number is required")
    if event_type not in _CATERING_ALLOWED_EVENTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Select a valid event type")
    try:
        guests = int(guests_raw)
        if guests < 1:
            raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Expected number of guests must be at least 1")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", event_date):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="A valid event date is required")
    if not isinstance(items, list) or not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Select at least one requested food item")
    if any(item not in _CATERING_ALLOWED_ITEMS for item in items):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid food item selected")

    items_json = json.dumps(items)

    database = await db.get_db()
    cursor = await database.execute(
        """INSERT INTO catering_requests
               (name, phone, event_type, guests, event_date, items, description, email_sent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, phone, event_type, guests, event_date, items_json, description or None, 0, db.now_iso()),
    )
    request_id = cursor.lastrowid
    await database.commit()
    await database.close()

    from_email = os.environ.get("SMTP_FROM", "catering@holysmokes.cc")
    to_email = os.environ.get("SMTP_TO", "catering@holysmokes.cc")

    subject, html_body, plain_body = _format_catering_email({
        "name": name,
        "phone": phone,
        "event_type": event_type,
        "guests": guests,
        "event_date": event_date,
        "items": items,
        "description": description,
    })

    async def _try_send_email() -> bool:
        sendgrid_key = os.environ.get("SENDGRID_API_KEY") or os.environ.get("SMTP_PASS")
        if sendgrid_key and (
            os.environ.get("SENDGRID_API_KEY")
            or os.environ.get("SMTP_HOST") == "smtp.sendgrid.net"
        ):
            await _send_sendgrid_email(sendgrid_key, from_email, to_email, subject, plain_body, html_body)
            return True

        mailgun_key = os.environ.get("MAILGUN_API_KEY") or os.environ.get("SMTP_PASS")
        mailgun_domain = os.environ.get("MAILGUN_DOMAIN") or os.environ.get("MAILGUN_FROM_DOMAIN")
        if mailgun_key and mailgun_domain:
            await _send_mailgun_email(mailgun_key, mailgun_domain, from_email, to_email, subject, plain_body, html_body)
            return True

        host = os.environ.get("SMTP_HOST")
        port = int(os.environ.get("SMTP_PORT", "587"))
        username = os.environ.get("SMTP_USER")
        password = os.environ.get("SMTP_PASS")

        if not host:
            return False

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = to_email
        msg["Reply-To"] = from_email
        msg.set_content(plain_body)
        msg.add_alternative(html_body, subtype="html")

        start_tls_env = os.environ.get("SMTP_STARTTLS", "").lower()
        use_tls = port == 465 or start_tls_env == "tls"
        start_tls = not use_tls and (start_tls_env in ("true", "1") or port == 587)

        send_kwargs = {
            "hostname": host,
            "port": port,
            "use_tls": use_tls,
            "start_tls": start_tls,
            "timeout": 20,
        }
        if username and password:
            send_kwargs["username"] = username
            send_kwargs["password"] = password

        await aiosmtplib.send(msg, **send_kwargs)
        return True

    email_sent = False
    try:
        email_sent = await _try_send_email()
    except Exception:
        # Do not fail the request if email cannot be sent; it is already saved.
        pass

    if email_sent:
        database = await db.get_db()
        await database.execute(
            "UPDATE catering_requests SET email_sent = 1 WHERE id = ?",
            (request_id,),
        )
        await database.commit()
        await database.close()

    return {"ok": True}


@app.get("/api/catering/requests")
async def list_catering_requests(user: dict = Depends(require_manager)):
    database = await db.get_db()
    cursor = await database.execute(
        "SELECT * FROM catering_requests ORDER BY created_at DESC"
    )
    rows = await cursor.fetchall()
    await database.close()
    results = []
    for row in rows:
        r = dict(row)
        try:
            r["items"] = json.loads(r["items"])
        except Exception:
            r["items"] = []
        results.append(r)
    return results


@app.delete("/api/catering/requests/{request_id}")
async def delete_catering_request(request_id: int, user: dict = Depends(require_manager)):
    database = await db.get_db()
    await database.execute("DELETE FROM catering_requests WHERE id = ?", (request_id,))
    await database.commit()
    await database.close()
    return {"ok": True}


async def broadcast(message: dict, channel: str):
    dead = []
    for conn in app.state.connections.get(channel, []):
        try:
            await conn.send_json(message)
        except Exception:
            dead.append(conn)
    for conn in dead:
        if conn in app.state.connections.get(channel, []):
            app.state.connections[channel].remove(conn)


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket, manager: bool = False):
    cookie = websocket.headers.get("cookie")
    try:
        user = await get_ws_user_from_cookie(cookie)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if manager and not user.get("is_manager"):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    channel = "manager" if manager else "general"
    await websocket.accept()
    app.state.connections[channel].append(websocket)

    database = await db.get_db()
    cursor = await database.execute(
        "SELECT * FROM chat_messages WHERE manager_chat = ? ORDER BY created_at DESC LIMIT 50",
        (int(manager),),
    )
    rows = await cursor.fetchall()
    await database.close()
    for row in reversed(rows):
        await websocket.send_json({"type": "message", "data": dict(row)})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            text = payload.get("text", "").strip()
            if not text:
                continue

            database = await db.get_db()
            await database.execute(
                "INSERT INTO chat_messages (user_email, user_name, text, manager_chat, created_at) VALUES (?, ?, ?, ?, ?)",
                (user["email"], user["name"], text, int(manager), db.now_iso()),
            )
            await database.commit()
            await database.close()

            message = {
                "user_email": user["email"],
                "user_name": user["name"],
                "text": text,
                "manager_chat": manager,
                "created_at": db.now_iso(),
            }
            await broadcast({"type": "message", "data": message}, channel)
    except WebSocketDisconnect:
        if websocket in app.state.connections[channel]:
            app.state.connections[channel].remove(websocket)


_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate, max-age=0"}


@app.get("/{path:path}")
async def serve_spa(path: str):
    # If the path has no extension, try serving the matching .html page.
    if path and "." not in os.path.basename(path):
        html_path = os.path.join(FRONTEND_DIR, path + ".html")
        if os.path.isfile(html_path):
            return FileResponse(html_path, headers=_NO_CACHE)
    file_path = os.path.join(FRONTEND_DIR, path)
    if path and os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path, headers=_NO_CACHE)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), headers=_NO_CACHE)
