import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import Request, HTTPException, status, WebSocketException
from jose import jwt, JWTError

try:
    from . import database as db
except ImportError:
    import database as db


def _get_required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def jwt_secret() -> str:
    return _get_required_env("JWT_SECRET")


def _normalize_email(email: str) -> str:
    return email.lower().strip()


def is_dccs_email(email: str) -> bool:
    return _normalize_email(email).endswith("@dccs.org")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    iterations = 100_000
    hash_value = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("ascii"), iterations
    ).hex()
    return f"pbkdf2:sha256:{iterations}:{salt}:{hash_value}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, algo, iterations, salt, hash_value = stored.split(":")
        new_hash = hashlib.pbkdf2_hmac(
            algo,
            password.encode("utf-8"),
            salt.encode("ascii"),
            int(iterations),
        ).hex()
        return hmac.compare_digest(new_hash, hash_value)
    except Exception:
        return False


def create_session_token(user: dict) -> str:
    payload = {
        "sub": user["email"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
        "is_manager": user.get("is_manager", False),
        "is_owner": user.get("is_owner", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def decode_session_token(token: str) -> dict:
    try:
        return jwt.decode(token, jwt_secret(), algorithms=["HS256"])
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
        """SELECT email, dc_email, password_hash, name, first_name, last_name, nickname, phone,
                  is_dc_employee, picture, is_manager, is_owner, onboarding_completed, created_at
           FROM users WHERE email = ?""",
        (email,),
    )
    row = await cursor.fetchone()
    await database.close()
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User not found")
    user = dict(row)
    user.pop("password_hash", None)
    return user


async def require_manager(request: Request) -> dict:
    user = await get_current_user(request)
    if not user.get("is_manager"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Manager access required")
    return user


async def require_owner(request: Request) -> dict:
    user = await get_current_user(request)
    if not user.get("is_owner"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Owner access required")
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
        user = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
        user["email"] = user.get("email") or user.get("sub")
        return user
    except JWTError as exc:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session") from exc
