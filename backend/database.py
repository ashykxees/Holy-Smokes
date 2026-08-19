import os
import aiosqlite
from datetime import datetime, timezone

if os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"):
    _default_db = os.path.join(os.environ["RAILWAY_VOLUME_MOUNT_PATH"], "holysmokes.db")
elif os.environ.get("FLY_APP_NAME"):
    _default_db = "/data/holysmokes.db"
else:
    _default_db = "data/holysmokes.db"

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
            is_approved INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS catering_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            event_type TEXT NOT NULL,
            guests INTEGER NOT NULL,
            event_date TEXT NOT NULL,
            items TEXT NOT NULL,
            description TEXT,
            email_sent INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inbound_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            in_reply_to TEXT,
            references_list TEXT,
            to_address TEXT NOT NULL,
            from_address TEXT NOT NULL,
            from_name TEXT,
            subject TEXT NOT NULL,
            body_text TEXT,
            body_html TEXT,
            raw_data TEXT,
            received_at TEXT NOT NULL,
            replied INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS email_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inbound_email_id INTEGER NOT NULL,
            sender_email TEXT NOT NULL,
            to_address TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_text TEXT,
            body_html TEXT,
            sent_at TEXT NOT NULL,
            FOREIGN KEY (inbound_email_id) REFERENCES inbound_emails(id) ON DELETE CASCADE
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
        ("is_approved", "INTEGER NOT NULL DEFAULT 0"),
    ]
    for col, dtype in additions:
        if col not in columns:
            await db.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")

    # Auto-approve existing owners and managers after the column is added.
    await db.execute("UPDATE users SET is_approved = 1 WHERE is_owner = 1 OR is_manager = 1")


def now_iso():
    return datetime.now(timezone.utc).isoformat()
