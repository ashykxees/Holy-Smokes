import os
from datetime import datetime, timezone, timedelta
from fastapi import Request, HTTPException, status, WebSocketException
from jose import jwt, JWTError
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

import database as db

GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
JWT_SECRET = os.environ["JWT_SECRET"]
MANAGER_EMAILS = {e.strip().lower() for e in os.environ.get("MANAGER_EMAILS", "").split(",") if e.strip()}


def create_session_token(user: dict) -> str:
    payload = {
        "sub": user["email"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
        "is_manager": user.get("is_manager", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid session") from exc


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_session_token(token)
    email = payload.get("email") or payload.get("sub")
    database = await db.get_db()
    cursor = await database.execute(
        """SELECT email, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, onboarding_completed, created_at
           FROM users WHERE email = ?""",
        (email,),
    )
    row = await cursor.fetchone()
    await database.close()
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return dict(row)


async def require_manager(request: Request) -> dict:
    user = await get_current_user(request)
    if not user.get("is_manager"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Manager access required")
    return user


def get_ws_user_from_cookie(cookie_header: str | None) -> dict:
    if not cookie_header:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Missing session cookie")
    token = None
    for part in cookie_header.split(";"):
        key, _, value = part.strip().partition("=")
        if key == "session":
            token = value
            break
    if not token:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Missing session cookie")
    try:
        user = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user["email"] = user.get("email") or user.get("sub")
        return user
    except JWTError as exc:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session") from exc


def is_manager_email(email: str) -> bool:
    return email.lower() in MANAGER_EMAILS


def verify_google_id_token(token: str) -> dict:
    try:
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Google token: {exc}") from exc

    email = idinfo.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Email not provided")

    hd = idinfo.get("hd")
    if hd != "dccs.org" and not email.endswith("@dccs.org"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only @dccs.org accounts are allowed")

    return {
        "email": email,
        "name": idinfo.get("name", email.split("@")[0]),
        "picture": idinfo.get("picture", ""),
    }
