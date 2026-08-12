import os
import json
import re
from contextlib import asynccontextmanager

import aiosqlite
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException, status, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
load_dotenv()

import database as db
from auth import (
    create_session_token,
    get_current_user,
    get_ws_user_from_cookie,
    is_manager_email,
    require_manager,
    verify_google_id_token,
)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
MAX_PICTURE_SIZE = 2 * 1024 * 1024  # 2 MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    app.state.connections = {"general": [], "manager": []}
    yield


app = FastAPI(title="Holy Smokes BBQ Team", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")


def _set_session_cookie(response: JSONResponse, user: dict) -> JSONResponse:
    token = create_session_token(user)
    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        secure=os.environ.get("SECURE_COOKIES", "false").lower() == "true",
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return response


@app.get("/api/config")
async def api_config():
    return {"google_client_id": os.environ.get("GOOGLE_CLIENT_ID", "")}


def _display_name(profile: dict) -> str:
    if profile.get("nickname"):
        return profile["nickname"].strip()
    parts = [profile.get("first_name", "").strip(), profile.get("last_name", "").strip()]
    return " ".join(p for p in parts if p) or profile.get("email", "").split("@")[0]


@app.post("/api/auth/google")
async def auth_google(request: Request):
    data = await request.json()
    id_token_val = data.get("id_token")
    if not id_token_val:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Missing id_token")

    google_user = verify_google_id_token(id_token_val)
    database = await db.get_db()
    cursor = await database.execute(
        "SELECT is_manager, onboarding_completed FROM users WHERE email = ?",
        (google_user["email"],),
    )
    row = await cursor.fetchone()

    is_manager = is_manager_email(google_user["email"]) or (bool(row["is_manager"]) if row else False)
    onboarding_completed = bool(row["onboarding_completed"]) if row else False

    await database.execute(
        """INSERT INTO users (email, name, picture, is_manager, onboarding_completed, created_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(email) DO UPDATE SET
             name = COALESCE(excluded.name, name),
             picture = COALESCE(excluded.picture, picture),
             is_manager = excluded.is_manager""",
        (
            google_user["email"],
            google_user["name"],
            google_user.get("picture", ""),
            int(is_manager),
            db.now_iso(),
        ),
    )
    await database.commit()
    await database.close()

    user = {
        "email": google_user["email"],
        "name": google_user["name"],
        "first_name": None,
        "last_name": None,
        "nickname": None,
        "phone": None,
        "is_dc_employee": False,
        "picture": google_user.get("picture", ""),
        "is_manager": is_manager,
        "onboarding_completed": onboarding_completed,
    }
    response = JSONResponse(user)
    return _set_session_cookie(response, user)


@app.post("/api/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session", path="/")
    return response


@app.get("/api/me")
async def me(user: dict = Depends(get_current_user)):
    return user


def _validate_profile(data: dict, require_complete: bool = True) -> dict:
    first_name = data.get("first_name", "").strip()
    last_name = data.get("last_name", "").strip()
    nickname = data.get("nickname", "").strip()
    phone = data.get("phone", "").strip()
    is_dc_employee = bool(data.get("is_dc_employee", False))
    picture = data.get("picture", "").strip()

    if require_complete:
        if not first_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="First name is required")
        if not last_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Last name is required")
        if not is_dc_employee and not phone:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Phone number is required unless you are a DC employee")

    if phone and not re.match(r"^[\d\s\-()+\.]{7,20}$", phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Phone number looks invalid")

    if picture and picture.startswith("data:image"):
        if len(picture) > MAX_PICTURE_SIZE:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Profile picture must be under 2 MB")

    display_name = nickname or " ".join([first_name, last_name]).strip() or "Team Member"
    return {
        "first_name": first_name or None,
        "last_name": last_name or None,
        "nickname": nickname or None,
        "phone": phone or None,
        "is_dc_employee": is_dc_employee,
        "picture": picture or None,
        "name": display_name,
    }


@app.post("/api/profile")
async def update_profile(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    profile = _validate_profile(data, require_complete=True)

    database = await db.get_db()
    await database.execute(
        """UPDATE users
           SET name = ?, first_name = ?, last_name = ?, nickname = ?, phone = ?,
               is_dc_employee = ?, picture = ?, onboarding_completed = 1
           WHERE email = ?""",
        (
            profile["name"],
            profile["first_name"],
            profile["last_name"],
            profile["nickname"],
            profile["phone"],
            int(profile["is_dc_employee"]),
            profile["picture"],
            user["email"],
        ),
    )
    await database.commit()

    cursor = await database.execute(
        """SELECT email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, onboarding_completed
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
        """SELECT email, name, first_name, last_name, nickname, picture FROM users ORDER BY name"""
    )
    rows = await cursor.fetchall()
    await database.close()
    return [dict(r) for r in rows]


@app.get("/api/tasks")
async def list_tasks(user: dict = Depends(get_current_user)):
    database = await db.get_db()
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


@app.post("/api/promote")
async def promote_manager(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    secret = data.get("secret", "")
    if secret != os.environ.get("MANAGER_SETUP_SECRET", ""):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid setup secret")
    database = await db.get_db()
    await database.execute(
        "UPDATE users SET is_manager = 1 WHERE email = ?",
        (user["email"],),
    )
    await database.commit()
    cursor = await database.execute("SELECT * FROM users WHERE email = ?", (user["email"],))
    row = await cursor.fetchone()
    await database.close()
    user_row = dict(row)
    response = JSONResponse({"is_manager": True})
    return _set_session_cookie(response, user_row)


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
        user = get_ws_user_from_cookie(cookie)
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


@app.get("/{path:path}")
async def serve_spa(path: str):
    file_path = os.path.join(FRONTEND_DIR, path)
    if path and os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
