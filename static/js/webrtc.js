/**
 * STIXIN WebRTC Mesh Audio Engine
 * Supports up to 10 active peers with Web Audio visualizer analysers
 */
class WebRTCManager {
  constructor(signalingSocket, onRemoteTrack, onVolumeUpdate, onPeerDisconnected) {
    this.socket = signalingSocket;
    this.onRemoteTrack = onRemoteTrack;
    this.onVolumeUpdate = onVolumeUpdate;
    this.onPeerDisconnected = onPeerDisconnected;

    this.localStream = null;
    this.audioContext = null;
    this.localAnalyser = null;
    this.remoteAnalysers = new Map();
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.remoteAudioElements = new Map();

    this.isMuted = false;
    this.speakingThreshold = 0.04;
    this.isSpeaking = false;
    this.animationFrameId = null;

    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      // Free public OpenRelay TURN configuration for restrictive NATs/Mobile Data
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];
  }

  async initLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      // Initialize Web Audio API for Volume/Waveform analysis
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.localAnalyser = this.audioContext.createAnalyser();
      this.localAnalyser.fftSize = 64;
      source.connect(this.localAnalyser);

      this.startLocalVolumeMonitoring();
      return true;
    } catch (err) {
      console.warn("Could not obtain microphone permissions:", err);
      // Fallback: create silent dummy stream so app can still run/listen
      this.localStream = this.createSilentAudioStream();
      return false;
    }
  }

  createSilentAudioStream() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false;
    return dst.stream;
  }

  startLocalVolumeMonitoring() {
    if (!this.localAnalyser) return;
    const dataArray = new Uint8Array(this.localAnalyser.frequencyBinCount);

    const checkVolume = () => {
      if (!this.localAnalyser) return;
      this.localAnalyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const normalizedVol = Math.min(1.0, average / 128);

      const currentlySpeaking = !this.isMuted && normalizedVol > this.speakingThreshold;
      if (currentlySpeaking !== this.isSpeaking) {
        this.isSpeaking = currentlySpeaking;
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            type: "speaking_state",
            speaking: this.isSpeaking,
            volume: normalizedVol
          }));
        }
      }

      if (this.onVolumeUpdate) {
        this.onVolumeUpdate("local", normalizedVol, this.isSpeaking);
      }

      this.animationFrameId = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  }

  toggleMute() {
    if (!this.localStream) return false;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: "mute_state",
        muted: this.isMuted
      }));
    }
    return this.isMuted;
  }

  async createPeerConnection(targetId, isInitiator) {
    if (this.peerConnections.has(targetId)) {
      return this.peerConnections.get(targetId);
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peerConnections.set(targetId, pc);

    // Add local audio tracks
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: "ice_candidate",
          target: targetId,
          candidate: event.candidate
        }));
      }
    };

    // Incoming remote track
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      
      // Attach to hidden audio element for playback
      let audioElem = this.remoteAudioElements.get(targetId);
      if (!audioElem) {
        audioElem = document.createElement('audio');
        audioElem.autoplay = true;
        this.remoteAudioElements.set(targetId, audioElem);
        document.body.appendChild(audioElem);
      }
      audioElem.srcObject = remoteStream;

      // Attach audio analyzer for remote speaker waveform
      this.attachRemoteAnalyser(targetId, remoteStream);

      if (this.onRemoteTrack) {
        this.onRemoteTrack(targetId, remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(targetId);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            type: "offer",
            target: targetId,
            sdp: pc.localDescription
          }));
        }
      } catch (err) {
        console.error(`Error creating offer for ${targetId}:`, err);
      }
    }

    return pc;
  }

  attachRemoteAnalyser(targetId, stream) {
    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      this.remoteAnalysers.set(targetId, analyser);
      this.monitorRemoteVolume(targetId);
    } catch (e) {
      console.warn(`Could not attach analyser for ${targetId}:`, e);
    }
  }

  monitorRemoteVolume(targetId) {
    const analyser = this.remoteAnalysers.get(targetId);
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      if (!this.remoteAnalysers.has(targetId)) return;
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const normalized = Math.min(1.0, avg / 128);
      const isSpeaking = normalized > this.speakingThreshold;

      if (this.onVolumeUpdate) {
        this.onVolumeUpdate(targetId, normalized, isSpeaking);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  async handleOffer(senderId, sdp) {
    const pc = await this.createPeerConnection(senderId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: "answer",
        target: senderId,
        sdp: pc.localDescription
      }));
    }
  }

  async handleAnswer(senderId, sdp) {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  async handleCandidate(senderId, candidate) {
    const pc = this.peerConnections.get(senderId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding ice candidate:", e);
      }
    }
  }

  closePeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    const audio = this.remoteAudioElements.get(peerId);
    if (audio) {
      audio.remove();
      this.remoteAudioElements.delete(peerId);
    }
    this.remoteAnalysers.delete(peerId);

    if (this.onPeerDisconnected) {
      this.onPeerDisconnected(peerId);
    }
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.remoteAudioElements.forEach((el) => el.remove());
    this.remoteAudioElements.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}
