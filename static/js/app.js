/**
 * STIXIN Audio-Only Conferencing & AI Agent Platform Main Controller
 * Multi-lingual Speech Input (Hindi/Hinglish) -> 100% English Intelligence Output
 */

const clientId = 'usr-' + Math.random().toString(36).substring(2, 9);

const state = {
  roomId: '',
  userName: '',
  language: 'en-IN',
  isMuted: false,
  participants: new Map(),
  aiBot: {
    bot_name: 'STIXIN AI Assistant',
    status: 'listening'
  },
  actionItems: [],
  transcripts: [],
  meetingStartTime: null,
  timerInterval: null,
  socket: null,
  webrtc: null,
  transcription: null,
  currentTab: 'action-items'
};

const elements = {
  lobbyView: document.getElementById('lobby-view'),
  conferenceView: document.getElementById('conference-view'),
  headerRoomBadge: document.getElementById('header-room-badge'),
  headerParticipantCount: document.getElementById('header-participant-count'),
  headerMeetingTimer: document.getElementById('header-meeting-timer'),
  headerLangSelect: document.getElementById('header-lang-select'),
  lobbyLangSelect: document.getElementById('lobby-lang-select'),
  participantsGrid: document.getElementById('participants-grid'),
  botCard: document.getElementById('bot-card'),
  botStatusBadge: document.getElementById('bot-status-badge'),
  transcriptList: document.getElementById('transcript-list'),
  actionItemsList: document.getElementById('action-items-list'),
  actionItemsBadge: document.getElementById('action-items-badge'),
  transcriptBadge: document.getElementById('transcript-badge'),
  btnMute: document.getElementById('btn-mute'),
  btnLeave: document.getElementById('btn-leave'),
  btnGenerateMoM: document.getElementById('btn-generate-mom'),
  momModal: document.getElementById('mom-modal'),
  momContent: document.getElementById('mom-content'),
  btnCloseMoM: document.getElementById('btn-close-mom'),
  btnDownloadMarkdown: document.getElementById('btn-download-md'),
  btnCopyMoM: document.getElementById('btn-copy-mom'),
  settingsModal: document.getElementById('settings-modal'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  geminiKeyInput: document.getElementById('gemini-api-key-input'),
  groqKeyInput: document.getElementById('groq-api-key-input'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  // Team Links Elements
  inviteModal: document.getElementById('invite-modal'),
  btnOpenInvite: document.getElementById('btn-open-invite'),
  btnCloseInvite: document.getElementById('btn-close-invite'),
  btnDoneInvite: document.getElementById('btn-done-invite'),
  newMemberNameInput: document.getElementById('new-member-name-input'),
  btnAddMemberLink: document.getElementById('btn-add-member-link'),
  teamLinksList: document.getElementById('team-links-list'),
  // Database Archive Elements
  archiveModal: document.getElementById('archive-modal'),
  btnOpenArchive: document.getElementById('btn-open-archive'),
  btnCloseArchive: document.getElementById('btn-close-archive'),
  btnCloseArchiveFooter: document.getElementById('btn-close-archive-footer'),
  archiveMeetingsList: document.getElementById('archive-meetings-list')
};

// Team Members State for Permanent Unique Links
let teamMembers = JSON.parse(localStorage.getItem('stixin_team_members') || '["Bhagirath", "Rohan (Frontend)", "Priya (Backend)"]');

// Initialize Settings
if (elements.geminiKeyInput) {
  elements.geminiKeyInput.value = localStorage.getItem('stixin_gemini_key') || '';
}
if (elements.groqKeyInput) {
  elements.groqKeyInput.value = localStorage.getItem('stixin_groq_key') || '';
}

async function joinRoom(roomId, userName, language) {
  if (!roomId.trim() || !userName.trim()) {
    alert("Please enter both a Room ID and Your Name.");
    return;
  }

  state.roomId = roomId.trim().toLowerCase();
  state.userName = userName.trim();
  state.language = language || 'en-IN';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${state.roomId}/${clientId}`;
  state.socket = new WebSocket(wsUrl);

  state.socket.onopen = async () => {
    console.log("WebSocket connected to room:", state.roomId);

    // Initialize WebRTC
    state.webrtc = new WebRTCManager(
      state.socket,
      (remoteId, stream) => handleRemoteStream(remoteId, stream),
      (peerId, volume, isSpeaking) => handleVolumeUpdate(peerId, volume, isSpeaking),
      (peerId) => removeParticipant(peerId)
    );

    const micGranted = await state.webrtc.initLocalMedia();

    // Initialize Web Speech Recognition with Hindi/Hinglish support
    state.transcription = new TranscriptionManager((text, isFinal) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({
          type: "transcript",
          text: text,
          is_final: isFinal
        }));
      }
    }, state.language);

    if (micGranted) {
      state.transcription.start();
    }

    // Send Join event
    state.socket.send(JSON.stringify({
      type: "join",
      user_name: state.userName,
      mic_muted: state.isMuted,
      timestamp: new Date().toLocaleTimeString()
    }));

    // Switch View
    elements.lobbyView.classList.add('view-hidden');
    elements.conferenceView.classList.remove('view-hidden');
    elements.headerRoomBadge.textContent = state.roomId.toUpperCase();
    if (elements.headerLangSelect) elements.headerLangSelect.value = state.language;

    startMeetingTimer();
    renderLocalParticipant();
  };

  state.socket.onmessage = (event) => {
    try {
      const data = jsonParseSafe(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error("Error processing message:", e);
    }
  };

  state.socket.onclose = () => {
    console.log("Disconnected from conference room.");
  };

  state.socket.onerror = (err) => {
    console.error("WebSocket encountered error:", err);
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      if (msg.existing_participants) {
        msg.existing_participants.forEach(p => {
          addParticipant(p);
          state.webrtc.createPeerConnection(p.client_id, true);
        });
      }
      if (msg.ai_agent) updateBotStatus(msg.ai_agent);
      if (msg.transcripts) {
        msg.transcripts.forEach(t => renderTranscriptEntry(t));
      }
      if (msg.action_items) {
        state.actionItems = msg.action_items;
        renderActionItems();
      }
      updateParticipantCount();
      break;

    case 'user_joined':
      addParticipant(msg.participant);
      updateParticipantCount();
      showToast(`${msg.participant.user_name} joined the meeting.`);
      break;

    case 'user_left':
      removeParticipant(msg.client_id);
      updateParticipantCount();
      showToast(`${msg.user_name || 'A participant'} left the meeting.`);
      break;

    case 'offer':
      state.webrtc.handleOffer(msg.sender, msg.sdp);
      break;

    case 'answer':
      state.webrtc.handleAnswer(msg.sender, msg.sdp);
      break;

    case 'ice_candidate':
      state.webrtc.handleCandidate(msg.sender, msg.candidate);
      break;

    case 'user_mute_updated':
      updateParticipantMute(msg.client_id, msg.mic_muted);
      break;

    case 'user_speaking_updated':
      updateParticipantSpeaking(msg.client_id, msg.is_speaking, msg.volume);
      break;

    case 'transcript_entry':
      renderTranscriptEntry(msg.entry);
      break;

    case 'transcript_interim':
      renderInterimTranscript(msg.speaker, msg.text);
      break;

    case 'action_items_updated':
      state.actionItems = msg.action_items;
      renderActionItems();
      if (msg.new_items && msg.new_items.length > 0) {
        showToast(`AI Bot detected ${msg.new_items.length} new English action item(s)!`);
        pulseBotCard();
      }
      break;

    case 'bot_status':
      updateBotStatus(msg.bot);
      break;

    case 'mom_ready':
      renderMoMModal(msg.mom);
      updateBotStatus(msg.bot_status);
      showToast("Minutes of Meeting (MoM) generated in English!");
      break;

    case 'error':
      alert(msg.message);
      break;
  }
}

// Participants Management
function renderLocalParticipant() {
  const card = document.createElement('div');
  card.id = `participant-local`;
  card.className = 'participant-card glass is-local';
  card.innerHTML = `
    <div class="mic-status-tag ${state.isMuted ? 'muted' : ''}" id="mic-tag-local">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      </svg>
    </div>
    <div class="avatar-wrapper">
      <div class="avatar-pulse-ring" id="pulse-ring-local"></div>
      <div class="avatar">${getInitials(state.userName)}</div>
    </div>
    <div class="participant-name">
      ${escapeHtml(state.userName)}
      <span class="role-badge">YOU</span>
    </div>
    <div class="audio-waveform" id="waveform-local">
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
    </div>
  `;
  elements.participantsGrid.prepend(card);
}

function addParticipant(p) {
  if (document.getElementById(`participant-${p.client_id}`)) return;
  state.participants.set(p.client_id, p);

  const card = document.createElement('div');
  card.id = `participant-${p.client_id}`;
  card.className = 'participant-card glass';
  card.innerHTML = `
    <div class="mic-status-tag ${p.mic_muted ? 'muted' : ''}" id="mic-tag-${p.client_id}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      </svg>
    </div>
    <div class="avatar-wrapper">
      <div class="avatar-pulse-ring" id="pulse-ring-${p.client_id}"></div>
      <div class="avatar">${getInitials(p.user_name)}</div>
    </div>
    <div class="participant-name">
      ${escapeHtml(p.user_name)}
    </div>
    <div class="audio-waveform" id="waveform-${p.client_id}">
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
    </div>
  `;
  elements.participantsGrid.appendChild(card);
}

function removeParticipant(peerId) {
  state.participants.delete(peerId);
  const card = document.getElementById(`participant-${peerId}`);
  if (card) card.remove();
  updateParticipantCount();
}

function updateParticipantMute(peerId, isMuted) {
  const micTag = document.getElementById(`mic-tag-${peerId}`);
  if (micTag) {
    if (isMuted) micTag.classList.add('muted');
    else micTag.classList.remove('muted');
  }
}

function updateParticipantSpeaking(peerId, isSpeaking, volume) {
  handleVolumeUpdate(peerId, volume || 0.5, isSpeaking);
}

function handleVolumeUpdate(peerId, volume, isSpeaking) {
  const cardId = peerId === 'local' ? 'participant-local' : `participant-${peerId}`;
  const card = document.getElementById(cardId);
  if (!card) return;

  if (isSpeaking) {
    card.classList.add('is-speaking');
  } else {
    card.classList.remove('is-speaking');
  }

  const waveContainer = document.getElementById(peerId === 'local' ? 'waveform-local' : `waveform-${peerId}`);
  if (waveContainer) {
    const bars = waveContainer.querySelectorAll('.wave-bar');
    bars.forEach((bar, idx) => {
      const height = isSpeaking ? Math.max(4, Math.min(22, volume * 35 * (0.8 + idx * 0.3))) : 4;
      bar.style.height = `${height}px`;
    });
  }
}

function updateParticipantCount() {
  const total = state.participants.size + 1;
  elements.headerParticipantCount.textContent = `${total} / 10 Active`;
}

// AI Bot Visuals
function updateBotStatus(bot) {
  if (!bot) return;
  state.aiBot = bot;
  let label = 'Listening (Hinglish/Hindi)';
  if (bot.status === 'drafting_mom') label = 'Drafting English MoM...';
  else if (bot.status === 'analyzing') label = 'Analyzing...';
  else if (bot.status === 'ready') label = 'Ready';

  elements.botStatusBadge.innerHTML = `
    <span class="bot-pulse-light"></span>
    ${label}
  `;
}

function pulseBotCard() {
  const botCard = document.getElementById('bot-card');
  if (botCard) {
    botCard.style.boxShadow = '0 0 45px rgba(6, 182, 212, 0.7)';
    setTimeout(() => {
      botCard.style.boxShadow = '';
    }, 1200);
  }
}

// Live Transcripts
function renderTranscriptEntry(entry) {
  const interim = document.getElementById('interim-transcript-bubble');
  if (interim) interim.remove();

  state.transcripts.push(entry);
  elements.transcriptBadge.textContent = state.transcripts.length;

  const bubble = document.createElement('div');
  bubble.className = 'transcript-bubble';
  bubble.innerHTML = `
    <div class="transcript-header">
      <span class="speaker-tag">${escapeHtml(entry.speaker)}</span>
      <span class="timestamp-tag">${entry.timestamp || ''}</span>
    </div>
    <div class="transcript-text">${escapeHtml(entry.text)}</div>
  `;
  elements.transcriptList.appendChild(bubble);
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
}

function renderInterimTranscript(speaker, text) {
  let interim = document.getElementById('interim-transcript-bubble');
  if (!interim) {
    interim = document.createElement('div');
    interim.id = 'interim-transcript-bubble';
    interim.className = 'transcript-bubble transcript-interim';
    elements.transcriptList.appendChild(interim);
  }
  interim.innerHTML = `
    <div class="transcript-header">
      <span class="speaker-tag">${escapeHtml(speaker)}</span>
      <span class="timestamp-tag">speaking...</span>
    </div>
    <div class="transcript-text">${escapeHtml(text)}</div>
  `;
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
}

// Action Items Board (English Output)
function renderActionItems() {
  elements.actionItemsList.innerHTML = '';
  elements.actionItemsBadge.textContent = state.actionItems.length;

  if (state.actionItems.length === 0) {
    elements.actionItemsList.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 2rem 1rem;">
        <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">No action items detected yet.</p>
        <p style="font-size: 0.75rem;">Speak in Hindi/Hinglish like <i>"Bhagirath kal tak backend deploy karega"</i> to auto-generate English tasks!</p>
      </div>
    `;
    return;
  }

  state.actionItems.forEach(item => {
    const card = document.createElement('div');
    card.className = `action-card ${item.status === 'completed' ? 'completed' : ''}`;
    card.innerHTML = `
      <div class="action-top-row">
        <input type="checkbox" class="action-checkbox" ${item.status === 'completed' ? 'checked' : ''} data-id="${item.id}" />
        <span class="action-task-text">${escapeHtml(item.task)}</span>
      </div>
      <div class="action-meta-row">
        <span class="assignee-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          ${escapeHtml(item.assignee || 'Team')}
        </span>
        <span class="deadline-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          ${escapeHtml(item.deadline || 'TBD')}
        </span>
      </div>
    `;

    const checkbox = card.querySelector('.action-checkbox');
    checkbox.addEventListener('change', (e) => {
      const newStatus = e.target.checked ? 'completed' : 'pending';
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({
          type: "update_action_item",
          id: item.id,
          status: newStatus
        }));
      }
    });

    elements.actionItemsList.appendChild(card);
  });
}

// MoM Actions
function triggerGenerateMoM() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    const geminiKey = localStorage.getItem('stixin_gemini_key') || null;
    const groqKey = localStorage.getItem('stixin_groq_key') || null;

    showToast("AI Bot is drafting Minutes of Meeting in English...");
    state.socket.send(JSON.stringify({
      type: "generate_mom",
      gemini_api_key: geminiKey,
      groq_api_key: groqKey
    }));
  }
}

function renderMoMModal(mom) {
  if (!mom) return;
  state.currentMoM = mom;

  let actionsHtml = '';
  if (mom.action_items && mom.action_items.length > 0) {
    actionsHtml = `
      <table class="mom-table">
        <thead>
          <tr>
            <th>Task (English)</th>
            <th>Assignee</th>
            <th>Deadline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${mom.action_items.map(a => `
            <tr>
              <td><strong>${escapeHtml(a.task)}</strong></td>
              <td>${escapeHtml(a.assignee)}</td>
              <td>${escapeHtml(a.deadline)}</td>
              <td><span style="color: ${a.status === 'completed' ? '#10b981' : '#f59e0b'}">${a.status.toUpperCase()}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    actionsHtml = '<p style="color: var(--text-dim); font-size: 0.85rem;">No action items recorded.</p>';
  }

  const topicsHtml = (mom.agenda_topics || []).map(t => `<li>${escapeHtml(t)}</li>`).join('');
  const decisionsHtml = (mom.key_decisions || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
  const nextStepsHtml = (mom.next_steps || []).map(n => `<li>${escapeHtml(n)}</li>`).join('');

  elements.momContent.innerHTML = `
    <div class="mom-document">
      <h2>${escapeHtml(mom.title || 'Minutes of Meeting')}</h2>
      
      <div class="mom-meta-bar">
        <div><strong>Date:</strong> ${mom.date}</div>
        <div><strong>Time:</strong> ${mom.time}</div>
        <div><strong>Duration:</strong> ${mom.duration}</div>
        <div><strong>Participants:</strong> ${(mom.participants || []).join(', ')}</div>
      </div>

      <div class="mom-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Executive Summary (English)
      </div>
      <p>${escapeHtml(mom.executive_summary || '')}</p>

      <div class="mom-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
        </svg>
        Agenda & Discussion Points
      </div>
      <ul class="mom-list">${topicsHtml || '<li>Technical synchronization</li>'}</ul>

      <div class="mom-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 14 14"/>
        </svg>
        Key Decisions Made
      </div>
      <ul class="mom-list">${decisionsHtml || '<li>Consensus reached on current milestones</li>'}</ul>

      <div class="mom-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        Action Items Matrix (English)
      </div>
      ${actionsHtml}

      <div class="mom-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8"/>
        </svg>
        Next Steps
      </div>
      <ul class="mom-list">${nextStepsHtml || '<li>Review action items prior to next standup.</li>'}</ul>

      <div style="margin-top: 2rem; font-size: 0.75rem; color: var(--text-dim); text-align: right;">
        Autonomously recorded and translated into English by ${escapeHtml(mom.generated_by || 'STIXIN AI Assistant')}
      </div>
    </div>
  `;

  elements.momModal.classList.remove('view-hidden');
}

function downloadMoMMarkdown() {
  window.open(`/api/rooms/${state.roomId}/mom/markdown`, '_blank');
}

function copyMoMToClipboard() {
  if (!state.currentMoM) return;
  const docText = `
MINUTES OF MEETING: ${state.currentMoM.title}
Date: ${state.currentMoM.date} | Duration: ${state.currentMoM.duration}
Participants: ${(state.currentMoM.participants || []).join(', ')}

EXECUTIVE SUMMARY:
${state.currentMoM.executive_summary}

KEY DECISIONS:
${(state.currentMoM.key_decisions || []).map(d => '- ' + d).join('\n')}

ACTION ITEMS:
${(state.currentMoM.action_items || []).map(a => `- [${a.status.toUpperCase()}] ${a.task} (Assignee: ${a.assignee}, Due: ${a.deadline})`).join('\n')}
  `.trim();

  navigator.clipboard.writeText(docText).then(() => {
    showToast("Meeting Minutes copied to clipboard!");
  });
}

function startMeetingTimer() {
  state.meetingStartTime = Date.now();
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - state.meetingStartTime) / 1000);
    const mins = String(Math.floor(diff / 60)).padStart(2, '0');
    const secs = String(diff % 60).padStart(2, '0');
    elements.headerMeetingTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function leaveCall() {
  if (confirm("Leave this audio conference?")) {
    if (state.webrtc) state.webrtc.destroy();
    if (state.transcription) state.transcription.stop();
    if (state.socket) state.socket.close();
    if (state.timerInterval) clearInterval(state.timerInterval);
    window.location.reload();
  }
}

function toggleMic() {
  if (!state.webrtc) return;
  state.isMuted = state.webrtc.toggleMute();

  const micTagLocal = document.getElementById('mic-tag-local');
  if (state.isMuted) {
    elements.btnMute.classList.remove('active-mic');
    elements.btnMute.classList.add('muted-mic');
    elements.btnMute.title = "Unmute Microphone";
    if (micTagLocal) micTagLocal.classList.add('muted');
    showToast("Microphone muted");
  } else {
    elements.btnMute.classList.remove('muted-mic');
    elements.btnMute.classList.add('active-mic');
    elements.btnMute.title = "Mute Microphone";
    if (micTagLocal) micTagLocal.classList.remove('muted');
    showToast("Microphone unmuted");
  }
}

function sendSimulatedSpeech(text) {
  if (!text || !text.trim()) return;
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: "transcript",
      text: text.trim(),
      is_final: true
    }));
  }
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '85px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(15, 23, 42, 0.95)';
  toast.style.color = '#fff';
  toast.style.padding = '0.65rem 1.25rem';
  toast.style.borderRadius = '999px';
  toast.style.border = '1px solid rgba(99, 102, 241, 0.4)';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  toast.style.fontSize = '0.82rem';
  toast.style.zIndex = '999';
  toast.style.pointerEvents = 'none';
  toast.textContent = msg;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 2800);
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonParseSafe(str) {
  try { return JSON.parse(str); } catch (e) { return {}; }
}

// Team Member Permanent Daily Links Functions
function renderTeamLinks() {
  if (!elements.teamLinksList) return;
  elements.teamLinksList.innerHTML = '';
  const currentRoom = state.roomId || document.getElementById('room-id-input').value.trim() || 'daily-standup';

  teamMembers.forEach((member, index) => {
    const cleanName = member.trim();
    const uniqueLink = `${window.location.origin}/?room=${encodeURIComponent(currentRoom)}&name=${encodeURIComponent(cleanName)}&autojoin=true`;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '0.75rem';
    row.style.padding = '0.75rem 1rem';
    row.style.background = 'rgba(15, 23, 42, 0.7)';
    row.style.borderRadius = '12px';
    row.style.border = '1px solid var(--border-color)';

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; color: #fff; flex-shrink: 0;">
          ${getInitials(cleanName)}
        </div>
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 700; font-size: 0.88rem; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(cleanName)}
          </div>
          <div style="font-size: 0.72rem; color: var(--accent-cyan); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(uniqueLink)}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 0.35rem; align-items: center;">
        <button class="btn btn-primary btn-copy-member-link" data-link="${escapeHtml(uniqueLink)}" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Link
        </button>
        <button class="btn btn-secondary btn-delete-member" data-index="${index}" style="padding: 0.35rem 0.55rem; font-size: 0.75rem; color: var(--accent-rose);" title="Remove">✕</button>
      </div>
    `;

    elements.teamLinksList.appendChild(row);
  });

  // Attach copy listeners
  elements.teamLinksList.querySelectorAll('.btn-copy-member-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const link = btn.getAttribute('data-link');
      navigator.clipboard.writeText(link).then(() => {
        showToast("Personal daily join link copied to clipboard!");
      });
    });
  });

  // Attach delete listeners
  elements.teamLinksList.querySelectorAll('.btn-delete-member').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      teamMembers.splice(idx, 1);
      localStorage.setItem('stixin_team_members', JSON.stringify(teamMembers));
      renderTeamLinks();
    });
  });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // 1. Check URL query params for Auto-Join (Personalized Unique Links)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  const nameParam = urlParams.get('name');
  const autoJoinParam = urlParams.get('autojoin');
  const langParam = urlParams.get('lang') || 'en-IN';

  if (roomParam) {
    const roomInput = document.getElementById('room-id-input');
    if (roomInput) roomInput.value = roomParam;
  }
  if (nameParam) {
    const nameInput = document.getElementById('user-name-input');
    if (nameInput) nameInput.value = nameParam;
  }

  // If person clicked their unique link with autojoin=true
  if (roomParam && nameParam && (autoJoinParam === 'true' || autoJoinParam === '1')) {
    showToast(`Welcome ${nameParam}! Auto-joining daily sync...`);
    setTimeout(() => {
      joinRoom(roomParam, nameParam, langParam);
    }, 600);
  }

  const joinForm = document.getElementById('join-form');
  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const roomId = document.getElementById('room-id-input').value;
      const userName = document.getElementById('user-name-input').value;
      const lang = elements.lobbyLangSelect ? elements.lobbyLangSelect.value : 'en-IN';
      joinRoom(roomId, userName, lang);
    });
  }

  const btnRandomRoom = document.getElementById('btn-random-room');
  if (btnRandomRoom) {
    btnRandomRoom.addEventListener('click', () => {
      const adjectives = ['daily', 'standup', 'sync', 'sprint', 'arch'];
      const randomWord = adjectives[Math.floor(Math.random() * adjectives.length)];
      const randomNum = Math.floor(100 + Math.random() * 900);
      document.getElementById('room-id-input').value = `${randomWord}-${randomNum}`;
      renderTeamLinks();
    });
  }

  // Invite & Unique Links Listeners
  if (elements.btnOpenInvite) {
    elements.btnOpenInvite.addEventListener('click', () => {
      renderTeamLinks();
      elements.inviteModal.classList.remove('view-hidden');
    });
  }
  if (elements.btnCloseInvite) elements.btnCloseInvite.addEventListener('click', () => elements.inviteModal.classList.add('view-hidden'));
  if (elements.btnDoneInvite) elements.btnDoneInvite.addEventListener('click', () => elements.inviteModal.classList.add('view-hidden'));
  
  if (elements.btnAddMemberLink && elements.newMemberNameInput) {
    elements.btnAddMemberLink.addEventListener('click', () => {
      const name = elements.newMemberNameInput.value.trim();
      if (name) {
        if (!teamMembers.includes(name)) {
          teamMembers.push(name);
          localStorage.setItem('stixin_team_members', JSON.stringify(teamMembers));
          renderTeamLinks();
          elements.newMemberNameInput.value = '';
          showToast(`Generated unique link for ${name}!`);
        } else {
          alert("This member is already in the list.");
        }
      }
    });
    elements.newMemberNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        elements.btnAddMemberLink.click();
      }
    });
  }

  // Database Meeting Archives Listeners
  async function loadMeetingArchives() {
    if (!elements.archiveMeetingsList) return;
    elements.archiveMeetingsList.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-dim);">
        <p>Loading records from cloud database...</p>
      </div>
    `;

    try {
      const resp = await fetch('/api/meetings');
      const data = await resp.json();
      const meetings = data.meetings || [];

      if (meetings.length === 0) {
        elements.archiveMeetingsList.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; color: var(--text-dim);">
            <p style="font-size: 0.95rem; margin-bottom: 0.5rem;">No past meeting records found in database.</p>
            <p style="font-size: 0.75rem;">Minutes of Meeting (MoMs) generated in your rooms will be permanently stored here.</p>
          </div>
        `;
        return;
      }

      elements.archiveMeetingsList.innerHTML = '';
      meetings.forEach(m => {
        const card = document.createElement('div');
        card.className = 'glass';
        card.style.borderRadius = '14px';
        card.style.padding = '1.1rem';
        card.style.border = '1px solid var(--border-color)';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '0.5rem';

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-weight: 700; font-size: 1rem; color: #fff;">${escapeHtml(m.title)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                ${m.date} • ${m.time} (${m.duration}) • Room: <strong style="color: var(--accent-cyan);">${m.room_id.toUpperCase()}</strong>
              </div>
            </div>
            <span class="pill-badge participants-pill" style="font-size: 0.72rem;">
              ${m.action_items_count} Action Items
            </span>
          </div>

          <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.45; margin: 0.35rem 0;">
            ${escapeHtml(m.executive_summary)}
          </p>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 0.65rem; margin-top: 0.35rem;">
            <div style="font-size: 0.72rem; color: var(--text-dim);">
              Attendees: ${(m.participants || []).join(', ')}
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-primary btn-view-archive-mom" data-room="${m.room_id}" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                View MoM
              </button>
              <a href="/api/rooms/${m.room_id}/mom/markdown" target="_blank" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                Download .MD
              </a>
            </div>
          </div>
        `;

        // View MoM listener
        card.querySelector('.btn-view-archive-mom').addEventListener('click', async () => {
          try {
            const detailResp = await fetch(`/api/meetings/${m.room_id}`);
            const detailData = await detailResp.json();
            if (detailData.meeting) {
              renderMoMModal(detailData.meeting);
            }
          } catch (err) {
            alert("Could not load meeting details.");
          }
        });

        elements.archiveMeetingsList.appendChild(card);
      });
    } catch (e) {
      elements.archiveMeetingsList.innerHTML = `<div style="color: var(--accent-rose); padding: 1.5rem; text-align: center;">Error loading archives from database.</div>`;
    }
  }

  if (elements.btnOpenArchive) {
    elements.btnOpenArchive.addEventListener('click', () => {
      loadMeetingArchives();
      elements.archiveModal.classList.remove('view-hidden');
    });
  }
  if (elements.btnCloseArchive) elements.btnCloseArchive.addEventListener('click', () => elements.archiveModal.classList.add('view-hidden'));
  if (elements.btnCloseArchiveFooter) elements.btnCloseArchiveFooter.addEventListener('click', () => elements.archiveModal.classList.add('view-hidden'));

  // Language switch listener in header
  if (elements.headerLangSelect) {
    elements.headerLangSelect.addEventListener('change', (e) => {
      const newLang = e.target.value;
      state.language = newLang;
      if (state.transcription) {
        state.transcription.setLanguage(newLang);
        showToast(`Microphone language changed to: ${newLang}`);
      }
    });
  }

  // Quick Hinglish Chips Listeners
  const quickChips = document.querySelectorAll('.quick-speech-chip');
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const phrase = chip.getAttribute('data-phrase');
      sendSimulatedSpeech(phrase);
      showToast(`Simulated: "${phrase}"`);
    });
  });

  if (elements.btnMute) elements.btnMute.addEventListener('click', toggleMic);
  if (elements.btnLeave) elements.btnLeave.addEventListener('click', leaveCall);
  if (elements.btnGenerateMoM) elements.btnGenerateMoM.addEventListener('click', triggerGenerateMoM);
  if (elements.btnCloseMoM) elements.btnCloseMoM.addEventListener('click', () => elements.momModal.classList.add('view-hidden'));
  if (elements.btnDownloadMarkdown) elements.btnDownloadMarkdown.addEventListener('click', downloadMoMMarkdown);
  if (elements.btnCopyMoM) elements.btnCopyMoM.addEventListener('click', copyMoMToClipboard);

  if (elements.btnOpenSettings) elements.btnOpenSettings.addEventListener('click', () => elements.settingsModal.classList.remove('view-hidden'));
  if (elements.btnCloseSettings) elements.btnCloseSettings.addEventListener('click', () => elements.settingsModal.classList.add('view-hidden'));
  if (elements.btnSaveSettings) {
    elements.btnSaveSettings.addEventListener('click', () => {
      localStorage.setItem('stixin_gemini_key', elements.geminiKeyInput.value.trim());
      localStorage.setItem('stixin_groq_key', elements.groqKeyInput.value.trim());
      elements.settingsModal.classList.add('view-hidden');
      showToast("AI Settings saved.");
    });
  }

  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-tab');
      state.currentTab = targetTab;

      if (targetTab === 'transcripts') {
        document.getElementById('tab-transcripts-content').classList.remove('view-hidden');
        document.getElementById('tab-actions-content').classList.add('view-hidden');
      } else {
        document.getElementById('tab-transcripts-content').classList.add('view-hidden');
        document.getElementById('tab-actions-content').classList.remove('view-hidden');
      }
    });
  });

  const simInput = document.getElementById('simulated-speech-input');
  const btnSendSim = document.getElementById('btn-send-simulated');
  if (btnSendSim && simInput) {
    btnSendSim.addEventListener('click', () => {
      sendSimulatedSpeech(simInput.value);
      simInput.value = '';
    });
    simInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendSimulatedSpeech(simInput.value);
        simInput.value = '';
      }
    });
  }

  const btnAddManualAction = document.getElementById('btn-add-action-manual');
  if (btnAddManualAction) {
    btnAddManualAction.addEventListener('click', () => {
      const task = prompt("Enter new action item / task (in English):");
      if (task && task.trim()) {
        const assignee = prompt("Assignee name:", state.userName) || "Team";
        const deadline = prompt("Deadline (e.g. Tomorrow, Friday, EOD):", "Friday") || "TBD";
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify({
            type: "add_action_item",
            task: task.trim(),
            assignee: assignee.trim(),
            deadline: deadline.trim()
          }));
        }
      }
    });
  }
});

