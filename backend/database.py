import os
import aiosqlite
from datetime import datetime, timezone

_default_db = "/data/holysmokes.db" if os.environ.get("FLY_APP_NAME") else "data/holysmokes.db"
DB_PATH = os.environ.get("DATABASE_PATH", _default_db)


def _schema() -> str:
    return """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            dc_email TEXT,
            password_hash TEXT,
            name TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            nickname TEXT,
            phone TEXT,
            is_dc_employee INTEGER NOT NULL DEFAULT 0,
            picture TEXT,
            is_manager INTEGER NOT NULL DEFAULT 0,
            is_owner INTEGER NOT NULL DEFAULT 0,
            onboarding_completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            assigned_to TEXT NOT NULL,
            created_by TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_by TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            author_email TEXT NOT NULL,
            author_name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            user_name TEXT NOT NULL,
            text TEXT NOT NULL,
            manager_chat INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
    """


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await get_db()
    await db.executescript(_schema())
    await _migrate_users(db)
    await db.commit()
    await db.close()


async def _migrate_users(db):
    """Add any columns introduced after the initial deploy."""
    async with db.execute("PRAGMA table_info(users)") as cursor:
        columns = {row["name"] for row in await cursor.fetchall()}
    additions = [
        ("first_name", "TEXT"),
        ("last_name", "TEXT"),
        ("nickname", "TEXT"),
        ("phone", "TEXT"),
        ("is_dc_employee", "INTEGER NOT NULL DEFAULT 0"),
        ("onboarding_completed", "INTEGER NOT NULL DEFAULT 0"),
        ("dc_email", "TEXT"),
        ("password_hash", "TEXT"),
        ("is_owner", "INTEGER NOT NULL DEFAULT 0"),
    ]
    for col, dtype in additions:
        if col not in columns:
            await db.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")


def now_iso():
    return datetime.now(timezone.utc).isoformat()
