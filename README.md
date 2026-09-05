# STIXIN Daily Meeting | Autonomous Audio-Only AI Conferencing Platform

A web-based, audio-only conferencing platform supporting **up to 10 active participants** per room, featuring an integrated autonomous **AI Agent Bot** ("STIXIN AI Assistant") that automatically joins every live session to transcribe speech in real-time, dynamically detect and track action items, and generate structured **Minutes of Meeting (MoM)** with one-click Markdown export.

---

## 🌟 Key Features

1. **Audio-Only WebRTC Mesh (Up to 10 Participants)**
   - Low-latency Opus audio P2P mesh.
   - Built-in Web Audio API analysers computing per-speaker volume and driving animated equalizer waveforms.
   - Active speaker ring glow and visual mute indicators.

2. **Integrated Autonomous AI Agent Bot**
   - Sits in every room as a persistent participant: **STIXIN AI Assistant**.
   - Displays real-time state: `Listening`, `Analyzing`, `Drafting MoM`.
   - Aggregates conversation history across all active speakers with timestamps.

3. **100% Free Live Speech-to-Text (Transcription)**
   - Powered by browser-native **Web Speech Recognition** running locally per-speaker.
   - Delivers studio-clean diarization (speaker name + time tag + utterance) with zero third-party API costs.
   - Real-time interim typing preview.

4. **Dynamic Action Item Tracking**
   - Autonomous extraction of commitments and deliverables:
     - Detects tasks, assigns ownership, and extracts deadlines (e.g., *"Bhagirath will complete the API docs by Friday"* ➔ Task: *Complete API docs*, Assignee: *Bhagirath*, Deadline: *By Friday*).
   - Live interactive Kanban checklist where tasks can be toggled as completed or manually added.

5. **Automated Minutes of Meeting (MoM) Engine**
   - Generates executive reports comprising:
     - Executive Summary
     - Agenda & Key Discussion Threads
     - Consensus Decisions Made
     - Action Items Matrix (Task, Assignee, Deadline, Status)
     - Next Steps
   - One-click copy to clipboard and `.md` Markdown file download.

6. **100% Free AI Stack with Optional LLM Upgrades**
   - **Built-in Offline Heuristic Synthesizer**: Works 100% free out of the box with zero external keys.
   - **Google Gemini Free Tier** & **Groq Free Tier** support configurable directly via the UI Settings modal.

---

## ☁️ 100% Free Cloud Database Setup (Neon.tech or Supabase)

To connect your 100% free Cloud PostgreSQL database:

1. Go to **[Neon.tech](https://neon.tech)** (or Supabase.com).
2. Click **Sign In with GitHub** or Google (**No credit card required**).
3. Create a free project (e.g., `stixin-daily-db`).
4. Copy your connection string:
   ```
   postgresql://username:password@ep-cold-lake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Set it in `.env` or as an environment variable:
   ```bash
   DATABASE_URL=postgresql://username:password@ep-cold-lake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   *(If left blank, the platform automatically runs on local persistent SQLite `stixin.db` for $0.00).*

---

## 🐳 Production Hosting with Docker

We have included a production-ready `Dockerfile` and `docker-compose.yml`:

### 1-Click Run with Docker Compose:
```bash
docker-compose up -d --build
```
The application will launch with container restart policies and environment mapping on port `8000`.

### Manual Docker Run:
```bash
docker build -t stixin-meeting .
docker run -d -p 8000:8000 -e DATABASE_URL="your-neon-url" --name stixin_meeting stixin-meeting
```

### 4. Open in Your Browser
Navigate to:
```
http://localhost:8000
```
- Enter a Room ID (e.g. `daily-standup`) and your display name.
- Click **Join Audio Conference**.
- Test with colleagues by opening multiple tabs or having teammates connect to the same Room ID!

---

## 🛠️ Project Structure

```
STIXIN DAILY MEETING/
├── server.py             # FastAPI server, WebRTC signaling & multi-room manager
├── ai_agent.py           # Autonomous AI Agent bot logic, action item extractor & MoM generator
├── requirements.txt      # Python dependencies (FastAPI, Uvicorn, WebSockets, HTTPX)
├── static/
│   ├── index.html        # Modern HTML5 app UI (Lobby, Conference Grid, Sidebar, MoM Modal)
│   ├── css/
│   │   └── style.css     # Dark mode styling, glassmorphism, responsive waveforms & glowing cards
│   └── js/
│       ├── app.js        # Main state manager, socket handlers, MoM viewer & toast notifications
│       ├── webrtc.js     # WebRTC Mesh manager, Web Audio visualizer analysers
│       └── transcription.js # Web Speech API manager for zero-cost continuous speech recognition
└── README.md             # Project documentation
```
