import os
import json
import logging
from typing import Dict, Any, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from ai_agent import AIAgent
from database import (
    init_db,
    db_save_transcript,
    db_save_action_item,
    db_update_action_item,
    db_save_mom,
    db_get_all_meetings,
    db_get_meeting_details
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("STIXINServer")

app = FastAPI(title="STIXIN Audio-Only Conferencing & AI Agent Platform")

@app.on_event("startup")
async def on_startup():
    await init_db()
    logger.info("STIXIN Database initialized and ready.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_PARTICIPANTS_PER_ROOM = 10

class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.participants: Dict[str, Dict[str, Any]] = {}
        self.connections: Dict[str, WebSocket] = {}
        self.ai_agent = AIAgent(room_id=room_id)

    def is_full(self) -> bool:
        return len(self.participants) >= MAX_PARTICIPANTS_PER_ROOM

    async def broadcast(self, message: Dict[str, Any], exclude: Optional[str] = None):
        payload = json.dumps(message)
        for client_id, ws in list(self.connections.items()):
            if client_id != exclude:
                try:
                    await ws.send_text(payload)
                except Exception as e:
                    logger.warning(f"Error sending to {client_id}: {e}")

    async def send_to(self, client_id: str, message: Dict[str, Any]):
        ws = self.connections.get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.warning(f"Error sending direct to {client_id}: {e}")

rooms: Dict[str, Room] = {}

def get_or_create_room(room_id: str) -> Room:
    clean_id = room_id.strip().lower()
    if clean_id not in rooms:
        rooms[clean_id] = Room(clean_id)
        logger.info(f"Created room: {clean_id} with autonomous AI Agent: {rooms[clean_id].ai_agent.bot_name}")
    return rooms[clean_id]

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await websocket.accept()
    room = get_or_create_room(room_id)

    if room.is_full() and client_id not in room.participants:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": f"Room is full! Maximum {MAX_PARTICIPANTS_PER_ROOM} participants allowed."
        }))
        await websocket.close()
        return

    room.connections[client_id] = websocket

    try:
        while True:
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            msg_type = data.get("type")

            if msg_type == "join":
                user_name = data.get("user_name", f"User-{client_id[:4]}")
                mic_muted = data.get("mic_muted", False)
                room.participants[client_id] = {
                    "client_id": client_id,
                    "user_name": user_name,
                    "mic_muted": mic_muted,
                    "is_speaking": False,
                    "joined_at": data.get("timestamp")
                }

                logger.info(f"User joined {room.room_id}: {user_name} ({client_id}). Active: {len(room.participants)}/10")

                # Send welcome bundle to joining user
                existing_list = [
                    p for cid, p in room.participants.items() if cid != client_id
                ]
                await room.send_to(client_id, {
                    "type": "welcome",
                    "client_id": client_id,
                    "room_id": room.room_id,
                    "existing_participants": existing_list,
                    "ai_agent": room.ai_agent.to_dict(),
                    "action_items": room.ai_agent.action_items,
                    "transcripts": room.ai_agent.transcripts,
                    "mom": room.ai_agent.mom
                })

                # Broadcast new participant to existing room members
                await room.broadcast({
                    "type": "user_joined",
                    "participant": room.participants[client_id],
                    "total_participants": len(room.participants)
                }, exclude=client_id)

            elif msg_type in ["offer", "answer", "ice_candidate"]:
                # Relay WebRTC signaling packets to specific peer
                target = data.get("target")
                if target:
                    data["sender"] = client_id
                    data["sender_name"] = room.participants.get(client_id, {}).get("user_name", "Peer")
                    await room.send_to(target, data)

            elif msg_type == "mute_state":
                is_muted = data.get("muted", False)
                if client_id in room.participants:
                    room.participants[client_id]["mic_muted"] = is_muted
                    await room.broadcast({
                        "type": "user_mute_updated",
                        "client_id": client_id,
                        "mic_muted": is_muted
                    })

            elif msg_type == "speaking_state":
                is_speaking = data.get("speaking", False)
                volume = data.get("volume", 0)
                if client_id in room.participants:
                    room.participants[client_id]["is_speaking"] = is_speaking
                    await room.broadcast({
                        "type": "user_speaking_updated",
                        "client_id": client_id,
                        "is_speaking": is_speaking,
                        "volume": volume
                    }, exclude=client_id)

            elif msg_type == "transcript":
                speaker = room.participants.get(client_id, {}).get("user_name", "Unknown")
                text = data.get("text", "")
                is_final = data.get("is_final", False)

                if is_final and text.strip():
                    result = room.ai_agent.add_transcript(speaker=speaker, text=text)
                    entry = result.get("entry")
                    detected_actions = result.get("detected_action_items", [])

                    # Persist transcript to Cloud Database
                    if entry:
                        await db_save_transcript(
                            room_id=room.room_id,
                            speaker=speaker,
                            text=text,
                            timestamp=entry.get("timestamp", "")
                        )

                    # Broadcast confirmed transcript
                    await room.broadcast({
                        "type": "transcript_entry",
                        "entry": entry
                    })

                    # If new action items detected by AI bot, persist and broadcast
                    if detected_actions:
                        logger.info(f"AI Bot detected {len(detected_actions)} action item(s) in {room.room_id}")
                        for act in detected_actions:
                            await db_save_action_item(room.room_id, act)

                        await room.broadcast({
                            "type": "action_items_updated",
                            "action_items": room.ai_agent.action_items,
                            "new_items": detected_actions,
                            "bot_status": room.ai_agent.to_dict()
                        })
                else:
                    # Interim transcript preview for zero-latency live visual
                    await room.broadcast({
                        "type": "transcript_interim",
                        "client_id": client_id,
                        "speaker": speaker,
                        "text": text
                    }, exclude=client_id)

            elif msg_type == "generate_mom":
                logger.info(f"Generating MoM for room {room.room_id}")
                gemini_key = data.get("gemini_api_key")
                groq_key = data.get("groq_api_key")
                
                participants_names = [p["user_name"] for p in room.participants.values()]
                
                # Notify room that bot is drafting MoM
                room.ai_agent.status = "drafting_mom"
                await room.broadcast({
                    "type": "bot_status",
                    "bot": room.ai_agent.to_dict()
                })

                mom = await room.ai_agent.generate_mom(
                    participants=participants_names,
                    gemini_api_key=gemini_key,
                    groq_api_key=groq_key
                )

                # Persist generated MoM to Cloud Database
                if mom:
                    await db_save_mom(room.room_id, mom)

                await room.broadcast({
                    "type": "mom_ready",
                    "mom": mom,
                    "bot_status": room.ai_agent.to_dict()
                })

            elif msg_type == "update_action_item":
                item_id = data.get("id")
                new_status = data.get("status")
                for item in room.ai_agent.action_items:
                    if item["id"] == item_id:
                        item["status"] = new_status
                        break
                # Persist update to Database
                if item_id and new_status:
                    await db_update_action_item(item_id, new_status)

                await room.broadcast({
                    "type": "action_items_updated",
                    "action_items": room.ai_agent.action_items
                })

            elif msg_type == "add_action_item":
                task = data.get("task", "").strip()
                assignee = data.get("assignee", "Team").strip()
                deadline = data.get("deadline", "TBD").strip()
                if task:
                    import uuid
                    new_item = {
                        "id": f"act-{str(uuid.uuid4())[:6]}",
                        "task": task,
                        "assignee": assignee or "Team",
                        "deadline": deadline or "TBD",
                        "status": "pending",
                        "detected_at": data.get("timestamp", "Manual"),
                        "source_text": "Added manually"
                    }
                    room.ai_agent.action_items.append(new_item)
                    # Persist manual action item to Database
                    await db_save_action_item(room.room_id, new_item)

                    await room.broadcast({
                        "type": "action_items_updated",
                        "action_items": room.ai_agent.action_items,
                        "new_items": [new_item]
                    })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {client_id}")
    except Exception as e:
        logger.error(f"WebSocket error for {client_id}: {e}")
    finally:
        # Cleanup on disconnect
        if client_id in room.connections:
            del room.connections[client_id]
        if client_id in room.participants:
            departed = room.participants.pop(client_id)
            logger.info(f"User left {room.room_id}: {departed['user_name']} ({client_id}). Remaining: {len(room.participants)}")
            await room.broadcast({
                "type": "user_left",
                "client_id": client_id,
                "user_name": departed["user_name"],
                "total_participants": len(room.participants)
            })

# REST Endpoints
@app.get("/api/rooms/{room_id}")
async def get_room_details(room_id: str):
    clean_id = room_id.strip().lower()
    if clean_id not in rooms:
        return {"room_id": clean_id, "exists": False, "participants_count": 0, "max": MAX_PARTICIPANTS_PER_ROOM}
    room = rooms[clean_id]
    return {
        "room_id": clean_id,
        "exists": True,
        "participants_count": len(room.participants),
        "max": MAX_PARTICIPANTS_PER_ROOM,
        "ai_agent": room.ai_agent.to_dict()
    }

@app.get("/api/rooms/{room_id}/mom/markdown")
async def export_mom_markdown(room_id: str):
    clean_id = room_id.strip().lower()
    if clean_id not in rooms or not rooms[clean_id].ai_agent.mom:
        raise HTTPException(status_code=404, detail="Minutes of Meeting not yet generated for this room.")
    
    mom = rooms[clean_id].ai_agent.mom
    
    # Format markdown
    actions_md = "| # | Task | Assignee | Deadline | Status |\n|---|---|---|---|---|\n"
    for idx, a in enumerate(mom.get("action_items", []), 1):
        status_icon = "Completed" if a.get("status") == "completed" else "Pending"
        actions_md += f"| {idx} | {a.get('task')} | {a.get('assignee')} | {a.get('deadline')} | {status_icon} |\n"
    
    decisions_md = "\n".join([f"- {d}" for d in mom.get("key_decisions", [])])
    topics_md = "\n".join([f"- {t}" for t in mom.get("agenda_topics", [])])
    next_md = "\n".join([f"- {n}" for n in mom.get("next_steps", [])])
    participants_md = ", ".join(mom.get("participants", []))

    md_content = f"""# {mom.get('title', 'Minutes of Meeting')}

**Date:** {mom.get('date')}  
**Time:** {mom.get('time')}  
**Duration:** {mom.get('duration')}  
**Participants:** {participants_md}  
**Generated By:** {mom.get('generated_by')} ({mom.get('generated_at', '')})  

---

## Executive Summary
{mom.get('executive_summary')}

---

## Agenda & Discussion Highlights
{topics_md if topics_md else 'None recorded.'}

---

## Key Decisions
{decisions_md if decisions_md else 'None recorded.'}

---

## Action Items
{actions_md}

---

## Next Steps
{next_md if next_md else 'None recorded.'}
"""
    return PlainTextResponse(
        content=md_content,
        headers={"Content-Disposition": f'attachment; filename="MoM_{clean_id}.md"'}
    )

@app.get("/api/meetings")
async def get_all_meetings_archive():
    """Retrieve list of all past meetings from the cloud database."""
    meetings = await db_get_all_meetings()
    return JSONResponse(content={"meetings": meetings})

@app.get("/api/meetings/{room_id}")
async def get_meeting_archive_details(room_id: str):
    """Retrieve details for a specific past meeting from the cloud database."""
    details = await db_get_meeting_details(room_id)
    if not details:
        raise HTTPException(status_code=404, detail="Meeting not found in database archive.")
    return JSONResponse(content={"meeting": details})

# Static Frontend Mount
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def serve_index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return PlainTextResponse("STIXIN Audio-Only Conferencing Platform Server Running. Index not found.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"Starting STIXIN Audio Conference Server on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
