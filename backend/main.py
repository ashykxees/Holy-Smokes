import os
import json
import re
import html
import base64
import asyncio
import traceback
import logging
import socket
import urllib.request
import urllib.error
from datetime import datetime, timezone
from urllib.parse import urlencode
from contextlib import asynccontextmanager
from email.message import EmailMessage

logger = logging.getLogger(__name__)

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


def _send_mailgun_email_sync(api_key: str, domain: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str, extra_headers: dict | None = None):
    data = {
        "from": from_email,
        "to": to_email,
        "subject": subject,
        "text": plain_body,
        "html": html_body,
    }
    if extra_headers:
        for key, value in extra_headers.items():
            data[f"h:{key}"] = value
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


async def _send_mailgun_email(api_key: str, domain: str, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str, extra_headers: dict | None = None):
    return await asyncio.to_thread(_send_mailgun_email_sync, api_key, domain, from_email, to_email, subject, plain_body, html_body, extra_headers)


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
        traceback.print_exc()
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


def _email_first_name(user: dict) -> str:
    name = (user.get("first_name") or user.get("nickname") or "").strip()
    if not name:
        full = (user.get("name") or "").strip()
        name = full.split()[0] if full else ""
    return name or "team"


def _email_local_part(user: dict) -> str:
    local = re.sub(r"[^a-zA-Z0-9.]+", "", _email_first_name(user).lower())
    return local[:64] or "team"


def _public_url_from_request(request: Request) -> str:
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.hostname
    return os.environ.get("PUBLIC_URL", f"{scheme}://{host}").rstrip("/")


def _email_signature_html(user: dict, public_url: str) -> str:
    display = _email_first_name(user)
    logo_url = f"{public_url.rstrip('/')}/assets/logo.png"
    website = "holysmokes.cc"
    return f"""<table style="border-collapse: collapse; font-family: Montserrat, Arial, sans-serif; color: #151614;" cellpadding="0" cellspacing="0">
  <tr>
    <td style="padding-right: 18px; vertical-align: middle;">
      <img src="{html.escape(logo_url)}" alt="Holy Smokes" style="height: 64px; width: auto; display: block;">
    </td>
    <td style="border-left: 2px solid #324A2A; padding-left: 18px; vertical-align: middle;">
      <p style="margin: 0; font-family: Oswald, Arial, sans-serif; font-weight: bold; font-size: 18px; color: #324A2A; text-transform: uppercase; letter-spacing: 0.03em;">{html.escape(display)}</p>
      <p style="margin: 4px 0 0 0; font-size: 14px; color: #151614; font-weight: bold;">Holy Smokes BBQ Team</p>
      <p style="margin: 4px 0 0 0; font-size: 14px;"><a href="https://{html.escape(website)}" style="color: #324A2A; text-decoration: none;">{html.escape(website)}</a></p>
    </td>
  </tr>
</table>"""


def _email_signature_text(user: dict) -> str:
    display = _email_first_name(user)
    return f"""--
{display}
Holy Smokes BBQ Team
holysmokes.cc"""


def _email_outgoing_allowed(user: dict) -> bool:
    allowed = [a.strip().lower() for a in (os.environ.get("OUTGOING_EMAIL_USERS") or "griffin,asa").split(",")]
    local = _email_local_part(user).lower()
    first = (user.get("first_name") or "").strip().lower()
    email_local = (user.get("email") or "").split("@")[0].lower()
    return local in allowed or first in allowed or email_local in allowed


def _zoho_smtp_credentials(user: dict) -> dict:
    local = _email_local_part(user).lower()
    prefix = local.upper()
    host = (
        os.environ.get(f"ZOHO_{prefix}_SMTP_HOST")
        or os.environ.get("ZOHO_SMTP_HOST")
        or os.environ.get("SMTP_HOST")
        or "smtp.zoho.com"
    )
    port = int(
        os.environ.get(f"ZOHO_{prefix}_SMTP_PORT")
        or os.environ.get("ZOHO_SMTP_PORT")
        or os.environ.get("SMTP_PORT")
        or "465"
    )
    username = (
        os.environ.get(f"ZOHO_{prefix}_USER")
        or os.environ.get(f"ZOHO_{prefix}_SMTP_USER")
        or os.environ.get("ZOHO_SMTP_USER")
        or os.environ.get("SMTP_USER")
    )
    password = (
        os.environ.get(f"ZOHO_{prefix}_PASS")
        or os.environ.get(f"ZOHO_{prefix}_SMTP_PASS")
        or os.environ.get("ZOHO_SMTP_PASS")
        or os.environ.get("SMTP_PASS")
    )
    start_tls_env = (
        os.environ.get(f"ZOHO_{prefix}_STARTTLS")
        or os.environ.get("ZOHO_SMTP_STARTTLS")
        or os.environ.get("SMTP_STARTTLS")
        or ""
    ).lower()
    use_tls = port == 465 or start_tls_env == "tls"
    start_tls = not use_tls and (start_tls_env in ("true", "1") or port == 587)
    return {
        "hostname": host,
        "port": port,
        "username": username,
        "password": password,
        "use_tls": use_tls,
        "start_tls": start_tls,
    }


def _create_ipv4_socket(host: str, port: int, timeout: float = 15):
    """Create and connect an IPv4 socket to avoid IPv6 issues on Railway."""
    infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    last_exc = None
    for family, socktype, proto, _, addr in infos:
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(timeout)
        try:
            sock.connect(addr)
            sock.setblocking(False)
            return sock
        except OSError as exc:
            last_exc = exc
            sock.close()
    raise last_exc or OSError(f"Could not connect to {host}:{port}")


async def _send_smtp_email(from_email: str, to_email: str, subject: str, plain_body: str, html_body: str, user: dict, extra_headers: dict | None = None):
    creds = _zoho_smtp_credentials(user)
    if not creds["hostname"] or not creds["username"] or not creds["password"]:
        raise Exception("SMTP credentials are not configured for this user")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Reply-To"] = from_email
    if extra_headers:
        for key, value in extra_headers.items():
            msg[key] = value
    msg.set_content(plain_body)
    msg.add_alternative(html_body, subtype="html")

    sock = await asyncio.to_thread(_create_ipv4_socket, creds["hostname"], creds["port"], 15)
    try:
        await aiosmtplib.send(
            msg,
            sock=sock,
            hostname=creds["hostname"],
            username=creds["username"],
            password=creds["password"],
            use_tls=creds["use_tls"],
            start_tls=creds["start_tls"],
            timeout=20,
        )
    except Exception:
        try:
            sock.close()
        except OSError:
            pass
        raise


import requests


def _zoho_accounts_url() -> str:
    region = os.environ.get("ZOHO_REGION", "com")
    return f"https://accounts.zoho.{region}/oauth/v2"


def _zoho_mail_api_url() -> str:
    region = os.environ.get("ZOHO_REGION", "com")
    return f"https://mail.zoho.{region}/api/accounts"


def _zoho_refresh_token_for_user(user: dict) -> str:
    local = _email_local_part(user).lower()
    prefix = local.upper()
    return (
        os.environ.get(f"ZOHO_{prefix}_REFRESH_TOKEN")
        or os.environ.get("ZOHO_REFRESH_TOKEN")
        or ""
    )


def _zoho_access_token(user: dict) -> str:
    refresh = _zoho_refresh_token_for_user(user)
    client_id = os.environ.get("ZOHO_CLIENT_ID")
    client_secret = os.environ.get("ZOHO_CLIENT_SECRET")
    if not refresh or not client_id or not client_secret:
        raise Exception("Zoho OAuth not configured for this user")

    url = f"{_zoho_accounts_url()}/token"
    params = {
        "refresh_token": refresh,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "scope": "ZohoMail.messages.ALL,ZohoMail.accounts.ALL,ZohoMail.folders.ALL",
    }
    resp = requests.post(url, params=params, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"Zoho token refresh failed: {resp.status_code} {resp.text}")
    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise Exception(f"Zoho token response missing access_token: {resp.text}")
    return access_token


def _zoho_find_account_id(access_token: str, from_email: str) -> str:
    url = _zoho_mail_api_url()
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    resp = requests.get(url, headers=headers, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"Failed to fetch Zoho accounts: {resp.status_code} {resp.text}")
    data = resp.json()
    accounts = data.get("data", [])
    if not accounts:
        raise Exception("No Zoho accounts found for this user")

    from_lower = from_email.lower()
    for account in accounts:
        if (account.get("mailboxAddress") or "").lower() == from_lower:
            return account["accountId"]
        for entry in account.get("emailAddress", []):
            if (entry.get("mailId") or "").lower() == from_lower:
                return account["accountId"]

    return accounts[0]["accountId"]


def _send_zoho_email_api_sync(from_email: str, to_email: str, subject: str, html_body: str, access_token: str, account_id: str):
    url = f"{_zoho_mail_api_url()}/{account_id}/messages"
    headers = {
        "Authorization": f"Zoho-oauthtoken {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "fromAddress": from_email,
        "toAddress": to_email,
        "subject": subject,
        "content": html_body,
        "mailFormat": "html",
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code not in (200, 201):
        raise Exception(f"Zoho Mail API error: {resp.status_code} {resp.text}")
    return resp.json()


async def _send_zoho_email_api(user: dict, from_email: str, to_email: str, subject: str, html_body: str):
    access_token = await asyncio.to_thread(_zoho_access_token, user)
    account_id = await asyncio.to_thread(_zoho_find_account_id, access_token, from_email)
    await asyncio.to_thread(_send_zoho_email_api_sync, from_email, to_email, subject, html_body, access_token, account_id)


async def _send_team_email_backend(user: dict, from_email: str, to_email: str, subject: str, plain_body: str, html_body: str, extra_headers: dict | None = None):
    if _zoho_refresh_token_for_user(user):
        await _send_zoho_email_api(user, from_email, to_email, subject, html_body)
        return
    await _send_smtp_email(from_email, to_email, subject, plain_body, html_body, user, extra_headers)


def _zoho_user_email(user: dict) -> str:
    from_domain = os.environ.get("EMAIL_FROM_DOMAIN") or os.environ.get("MAILGUN_DOMAIN") or "holysmokes.cc"
    return f"{_email_local_part(user)}@{from_domain}"


def _zoho_inbox_folder_id(access_token: str, account_id: str) -> str:
    url = f"{_zoho_mail_api_url()}/{account_id}/folders"
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    resp = requests.get(url, headers=headers, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"Failed to fetch Zoho folders: {resp.status_code} {resp.text}")
    data = resp.json()
    for folder in data.get("data", []):
        if folder.get("folderName") == "Inbox":
            return folder["folderId"]
    raise Exception("Inbox folder not found")


def _zoho_fetch_message_content(access_token: str, account_id: str, folder_id: str, message_id: str) -> str:
    url = f"{_zoho_mail_api_url()}/{account_id}/folders/{folder_id}/messages/{message_id}/content"
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    resp = requests.get(url, headers=headers, params={"includeBlockContent": "true"}, timeout=20)
    if resp.status_code != 200:
        return ""
    data = resp.json()
    return data.get("data", {}).get("content") or ""


def _zoho_ms_to_iso(value) -> str:
    try:
        ts = int(value) / 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return datetime.now(timezone.utc).isoformat()


def _zoho_strip_html_to_text(raw_html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw_html or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


async def _zoho_sync_inbox_for_user_async(user: dict) -> int:
    refresh = _zoho_refresh_token_for_user(user)
    if not refresh:
        return 0
    access_token = _zoho_access_token(user)
    user_email = _zoho_user_email(user)
    account_id = _zoho_find_account_id(access_token, user_email)
    folder_id = _zoho_inbox_folder_id(access_token, account_id)

    url = f"{_zoho_mail_api_url()}/{account_id}/messages/view"
    headers = {"Authorization": f"Zoho-oauthtoken {access_token}"}
    params = {"folderId": folder_id, "limit": 50, "sortBy": "date", "sortorder": "false"}
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Failed to list Zoho messages: {resp.status_code} {resp.text}")
    data = resp.json()
    messages = data.get("data", [])

    database = await db.get_db()
    try:
        added = 0
        for msg in messages:
            zoho_id = str(msg.get("messageId"))
            if not zoho_id:
                continue
            cursor = await database.execute("SELECT id FROM inbound_emails WHERE message_id = ?", (zoho_id,))
            existing = await cursor.fetchone()
            if existing:
                continue
            content = _zoho_fetch_message_content(access_token, account_id, folder_id, zoho_id)
            from_full = msg.get("fromAddress") or ""
            from_name, from_address = _parse_email_address(from_full) if "<" in from_full else (msg.get("sender") or "", from_full)
            if not from_address:
                from_address = from_full
            to_full = msg.get("toAddress") or user_email
            _, to_address = _parse_email_address(to_full) if "<" in to_full else ("", to_full)
            body_text = _zoho_strip_html_to_text(content)
            await database.execute(
                """INSERT INTO inbound_emails
                   (message_id, in_reply_to, references_list, to_address, from_address, from_name,
                    subject, body_text, body_html, raw_data, received_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    zoho_id,
                    None,
                    None,
                    to_address,
                    from_address,
                    from_name,
                    msg.get("subject") or "",
                    body_text,
                    content,
                    json.dumps(msg),
                    _zoho_ms_to_iso(msg.get("receivedTime") or msg.get("sentDateInGMT")),
                ),
            )
            added += 1
        await database.commit()
        return added
    finally:
        await database.close()


def _zoho_sync_inbox_for_user_sync(user: dict) -> int:
    return asyncio.run(_zoho_sync_inbox_for_user_async(user))


async def _sync_zoho_inbox(user: dict):
    try:
        return await asyncio.to_thread(_zoho_sync_inbox_for_user_sync, user)
    except Exception as exc:
        logger.warning("Zoho inbox sync failed for %s: %s", user.get("email"), exc)
        return 0


@app.post("/api/email/send")
async def send_team_email(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    to_email = (data.get("to") or "").strip()
    subject = (data.get("subject") or "").strip()
    body_text = (data.get("body") or "").strip()

    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to_email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="A valid recipient email is required")
    if not subject:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Subject is required")
    if not body_text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Body is required")
    if not _email_outgoing_allowed(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You do not have permission to send team email")

    from_domain = os.environ.get("EMAIL_FROM_DOMAIN") or os.environ.get("MAILGUN_DOMAIN") or "holysmokes.cc"
    from_email = f"{_email_local_part(user)}@{from_domain}"

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.hostname
    public_url = os.environ.get("PUBLIC_URL", f"{scheme}://{host}").rstrip("/")

    escaped_body = html.escape(body_text).replace("\n", "<br>")
    html_body = f"""<div style="font-family: Montserrat, Arial, sans-serif; color: #151614; line-height: 1.6;">
{escaped_body}
</div>
<br><br>
{_email_signature_html(user, public_url)}"""
    plain_body = f"""{body_text}

{_email_signature_text(user)}"""

    try:
        await _send_team_email_backend(user, from_email, to_email, subject, plain_body, html_body)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to send email: {exc}") from exc

    return {"ok": True}


def _parse_email_address(value: str) -> tuple[str, str]:
    value = (value or "").strip()
    if not value:
        return ("", "")
    match = re.match(r"^\s*\"?([^\"<>]+)\"?\s*<([^>]+)>\s*$", value)
    if match:
        name = match.group(1).strip()
        email = match.group(2).strip()
        return (name, email)
    return ("", value)


@app.post("/api/email/inbound")
async def email_inbound(request: Request):
    secret = os.environ.get("EMAIL_WEBHOOK_SECRET")
    provided = request.query_params.get("token") or request.headers.get("x-email-token")
    logger.warning("Inbound email webhook called. token_present=%s secret_set=%s matches=%s", bool(provided), bool(secret), (not secret or provided == secret))
    if secret and provided != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook token")

    form = await request.form()
    data = {}
    for key, value in form.multi_items():
        if isinstance(value, str):
            data[key] = value

    logger.warning("Inbound email fields: %s", json.dumps({k: v[:200] if isinstance(v, str) else v for k, v in data.items()}))

    to_address = (data.get("recipient") or "").strip().lower()
    from_full = (data.get("from") or data.get("sender") or "").strip()
    from_name, from_address = _parse_email_address(from_full)
    if not from_address:
        from_address = (data.get("sender") or "").strip()
    logger.warning("Parsed inbound: to=%s from=%s name=%s", to_address, from_address, from_name)
    if not to_address or not from_address:
        return {"ok": False, "error": "Missing recipient or sender"}

    subject = (data.get("subject") or "").strip()
    body_text = (
        data.get("stripped-text")
        or data.get("stripped_text")
        or data.get("body-plain")
        or data.get("body_plain")
        or data.get("body")
        or ""
    )
    body_html = (
        data.get("stripped-html")
        or data.get("stripped_html")
        or data.get("body-html")
        or data.get("body_html")
        or ""
    )

    message_id = data.get("Message-Id") or data.get("Message-ID") or data.get("message-id")
    in_reply_to = data.get("In-Reply-To") or data.get("in-reply-to")
    references = data.get("References") or data.get("references")

    database = await db.get_db()
    await database.execute(
        """INSERT INTO inbound_emails
           (message_id, in_reply_to, references_list, to_address, from_address, from_name,
            subject, body_text, body_html, raw_data, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            message_id,
            in_reply_to,
            references,
            to_address,
            from_address,
            from_name,
            subject,
            body_text,
            body_html,
            json.dumps(data),
            db.now_iso(),
        ),
    )
    await database.commit()
    await database.close()
    return {"ok": True}


@app.get("/api/inbox")
async def list_inbox(user: dict = Depends(get_current_user)):
    # Sync latest messages from the user's Zoho mailbox if configured.
    await _sync_zoho_inbox(user)

    database = await db.get_db()
    cursor = await database.execute(
        "SELECT * FROM inbound_emails ORDER BY received_at DESC"
    )
    rows = await cursor.fetchall()
    results = []
    for row in rows:
        r = dict(row)
        text = (r.get("body_text") or "").replace("\n", " ")
        r["snippet"] = text[:140]
        results.append(r)
    await database.close()
    return results


@app.get("/api/inbox/{email_id}")
async def get_inbox_email(email_id: int, user: dict = Depends(get_current_user)):
    database = await db.get_db()
    cursor = await database.execute("SELECT * FROM inbound_emails WHERE id = ?", (email_id,))
    row = await cursor.fetchone()
    if not row:
        await database.close()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Email not found")
    email = dict(row)
    cursor = await database.execute(
        "SELECT * FROM email_replies WHERE inbound_email_id = ? ORDER BY sent_at ASC",
        (email_id,),
    )
    email["replies"] = [dict(r) for r in await cursor.fetchall()]
    await database.close()
    return email


@app.post("/api/inbox/{email_id}/reply")
async def reply_inbox_email(request: Request, email_id: int, user: dict = Depends(get_current_user)):
    if not _email_outgoing_allowed(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You do not have permission to reply to team email")

    data = await request.json()
    reply_text = (data.get("body") or "").strip()
    if not reply_text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Reply body is required")

    database = await db.get_db()
    cursor = await database.execute("SELECT * FROM inbound_emails WHERE id = ?", (email_id,))
    row = await cursor.fetchone()
    if not row:
        await database.close()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Email not found")
    inbound = dict(row)

    from_domain = os.environ.get("EMAIL_FROM_DOMAIN") or os.environ.get("MAILGUN_DOMAIN") or "holysmokes.cc"
    from_email = f"{_email_local_part(user)}@{from_domain}"
    to_email = inbound["from_address"]
    subject = inbound["subject"]
    if subject and not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    quote_text = (inbound.get("body_text") or "").strip()
    quoted = "\n".join(f"> {line}" for line in quote_text.splitlines())
    quoted_html = html.escape(quote_text).replace("\n", "<br>")
    reply_escaped = html.escape(reply_text).replace("\n", "<br>")
    public_url = _public_url_from_request(request)

    plain_body = f"""{reply_text}

On {inbound.get('received_at')}, {inbound.get('from_name') or to_email} wrote:
{quoted}

{_email_signature_text(user)}"""

    html_body = f"""<div style="font-family: Montserrat, Arial, sans-serif; color: #151614; line-height: 1.6;">
{reply_escaped}
</div>
<div style="border-left: 2px solid #cccccc; margin: 16px 0 0 0; padding: 0 0 0 12px; color: #555555;">
  <p style="margin: 0 0 8px 0;">On {html.escape(inbound.get('received_at') or '')}, {html.escape(inbound.get('from_name') or to_email)} wrote:</p>
  <div>{quoted_html}</div>
</div>
<br><br>
{_email_signature_html(user, public_url)}"""

    extra_headers = {}
    if inbound.get("message_id"):
        extra_headers["In-Reply-To"] = inbound["message_id"]
        refs = [inbound["message_id"]]
        if inbound.get("references_list"):
            refs.insert(0, inbound["references_list"])
        extra_headers["References"] = " ".join(refs)

    try:
        await _send_team_email_backend(user, from_email, to_email, subject, plain_body, html_body, extra_headers)
    except Exception as exc:
        await database.close()
        traceback.print_exc()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to send reply: {exc}") from exc

    await database.execute(
        """INSERT INTO email_replies
           (inbound_email_id, sender_email, to_address, subject, body_text, body_html, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            email_id,
            user["email"],
            to_email,
            subject,
            reply_text,
            html_body,
            db.now_iso(),
        ),
    )
    await database.execute("UPDATE inbound_emails SET replied = 1 WHERE id = ?", (email_id,))
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
