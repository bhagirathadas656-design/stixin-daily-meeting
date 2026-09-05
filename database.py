import os
import json
import logging
import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, DeclarativeBase
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, select, desc, update

logger = logging.getLogger("STIXINDatabase")

# Determine Database URL (Cloud PostgreSQL vs Local SQLite fallback)
RAW_DB_URL = os.environ.get("DATABASE_URL", "").strip()

if RAW_DB_URL:
    # Normalize postgres:// to postgresql+asyncpg:// for SQLAlchemy async driver
    if RAW_DB_URL.startswith("postgres://"):
        DATABASE_URL = RAW_DB_URL.replace("postgres://", "postgresql+asyncpg://", 1)
    elif RAW_DB_URL.startswith("postgresql://") and not RAW_DB_URL.startswith("postgresql+asyncpg://"):
        DATABASE_URL = RAW_DB_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    else:
        DATABASE_URL = RAW_DB_URL
    logger.info(f"Connecting to Cloud PostgreSQL Database: {DATABASE_URL.split('@')[-1]}")
else:
    # Local fallback SQLite database
    DATABASE_URL = "sqlite+aiosqlite:///./stixin.db"
    logger.info("No DATABASE_URL found. Using persistent SQLite database (./stixin.db).")

engine_args = {
    "echo": False,
    "future": True
}

# Supabase connection pooler compatibility with asyncpg
if "postgresql+asyncpg" in DATABASE_URL:
    engine_args["connect_args"] = {
        "statement_cache_size": 0
    }

engine = create_async_engine(DATABASE_URL, **engine_args)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

class Base(DeclarativeBase):
    pass

class MeetingRoomModel(Base):
    __tablename__ = "meeting_rooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(128), unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String(32), default="active")  # active, completed

class TranscriptModel(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(128), index=True, nullable=False)
    speaker = Column(String(128), nullable=False)
    text = Column(Text, nullable=False)
    timestamp = Column(String(32), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ActionItemModel(Base):
    __tablename__ = "action_items"

    id = Column(String(64), primary_key=True)
    room_id = Column(String(128), index=True, nullable=False)
    task = Column(Text, nullable=False)
    assignee = Column(String(128), default="Team")
    deadline = Column(String(64), default="TBD")
    status = Column(String(32), default="pending")  # pending, completed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class MoMRecordModel(Base):
    __tablename__ = "mom_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(128), index=True, nullable=False)
    title = Column(String(256), nullable=False)
    date = Column(String(64), nullable=False)
    time = Column(String(32), nullable=False)
    duration = Column(String(64), nullable=False)
    participants = Column(JSON, nullable=False)
    executive_summary = Column(Text, nullable=False)
    agenda_topics = Column(JSON, nullable=False)
    key_decisions = Column(JSON, nullable=False)
    action_items = Column(JSON, nullable=False)
    next_steps = Column(JSON, nullable=False)
    generated_by = Column(String(128), default="STIXIN AI Assistant")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

async def init_db():
    """Create tables if they do not exist."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")

async def db_save_transcript(room_id: str, speaker: str, text: str, timestamp: str):
    try:
        async with AsyncSessionLocal() as session:
            record = TranscriptModel(
                room_id=room_id.lower(),
                speaker=speaker,
                text=text,
                timestamp=timestamp
            )
            session.add(record)
            await session.commit()
    except Exception as e:
        logger.error(f"Error saving transcript to DB: {e}")

async def db_save_action_item(room_id: str, item: Dict[str, Any]):
    try:
        async with AsyncSessionLocal() as session:
            record = ActionItemModel(
                id=item["id"],
                room_id=room_id.lower(),
                task=item["task"],
                assignee=item.get("assignee", "Team"),
                deadline=item.get("deadline", "TBD"),
                status=item.get("status", "pending")
            )
            session.add(record)
            await session.commit()
    except Exception as e:
        logger.error(f"Error saving action item to DB: {e}")

async def db_update_action_item(item_id: str, status: str):
    try:
        async with AsyncSessionLocal() as session:
            stmt = update(ActionItemModel).where(ActionItemModel.id == item_id).values(status=status)
            await session.execute(stmt)
            await session.commit()
    except Exception as e:
        logger.error(f"Error updating action item in DB: {e}")

async def db_save_mom(room_id: str, mom: Dict[str, Any]):
    try:
        async with AsyncSessionLocal() as session:
            record = MoMRecordModel(
                room_id=room_id.lower(),
                title=mom.get("title", f"Minutes of Meeting: {room_id}"),
                date=mom.get("date", datetime.datetime.now().strftime("%B %d, %Y")),
                time=mom.get("time", datetime.datetime.now().strftime("%H:%M:%S")),
                duration=mom.get("duration", "1 minute"),
                participants=mom.get("participants", []),
                executive_summary=mom.get("executive_summary", ""),
                agenda_topics=mom.get("agenda_topics", []),
                key_decisions=mom.get("key_decisions", []),
                action_items=mom.get("action_items", []),
                next_steps=mom.get("next_steps", []),
                generated_by=mom.get("generated_by", "STIXIN AI Assistant")
            )
            session.add(record)
            await session.commit()
            logger.info(f"Successfully stored MoM record for {room_id} in Database.")
    except Exception as e:
        logger.error(f"Error saving MoM to DB: {e}")

async def db_get_all_meetings() -> List[Dict[str, Any]]:
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(MoMRecordModel).order_by(desc(MoMRecordModel.created_at)).limit(30)
            result = await session.execute(stmt)
            records = result.scalars().all()
            return [
                {
                    "id": r.id,
                    "room_id": r.room_id,
                    "title": r.title,
                    "date": r.date,
                    "time": r.time,
                    "duration": r.duration,
                    "participants": r.participants,
                    "executive_summary": r.executive_summary,
                    "action_items_count": len(r.action_items) if isinstance(r.action_items, list) else 0,
                    "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""
                }
                for r in records
            ]
    except Exception as e:
        logger.error(f"Error fetching meetings from DB: {e}")
        return []

async def db_get_meeting_details(room_id: str) -> Optional[Dict[str, Any]]:
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(MoMRecordModel).where(MoMRecordModel.room_id == room_id.lower()).order_by(desc(MoMRecordModel.created_at)).limit(1)
            result = await session.execute(stmt)
            r = result.scalar_one_or_none()
            if not r:
                return None
            return {
                "id": r.id,
                "room_id": r.room_id,
                "title": r.title,
                "date": r.date,
                "time": r.time,
                "duration": r.duration,
                "participants": r.participants,
                "executive_summary": r.executive_summary,
                "agenda_topics": r.agenda_topics,
                "key_decisions": r.key_decisions,
                "action_items": r.action_items,
                "next_steps": r.next_steps,
                "generated_by": r.generated_by,
                "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""
            }
    except Exception as e:
        logger.error(f"Error fetching meeting details for {room_id}: {e}")
        return None
