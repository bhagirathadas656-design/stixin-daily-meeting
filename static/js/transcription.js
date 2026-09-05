/**
 * STIXIN Real-Time Speech Recognition Engine
 * Zero-Cost Client-Side Transcription via Web Speech API
 * Supports Hindi (hi-IN), Indian English / Hinglish (en-IN), and English (en-US)
 */
class TranscriptionManager {
  constructor(onTranscript, language = 'en-IN') {
    this.onTranscript = onTranscript;
    this.recognition = null;
    this.isListening = false;
    this.shouldRestart = true;
    this.language = language; // Default to 'en-IN' for natural Hinglish recognition

    this.init();
  }

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Web Speech API not supported in this browser environment. Using manual/simulation fallback.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;

    this.recognition.onstart = () => {
      this.isListening = true;
      console.log(`Speech recognition started with language: ${this.language}`);
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript.trim() && this.onTranscript) {
        this.onTranscript(finalTranscript.trim(), true);
      } else if (interimTranscript.trim() && this.onTranscript) {
        this.onTranscript(interimTranscript.trim(), false);
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error !== 'no-speech') {
        console.warn("Speech recognition error:", event.error);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.shouldRestart) {
        setTimeout(() => {
          if (this.shouldRestart) {
            try {
              this.recognition.start();
            } catch (e) {
              // Ignore if already starting
            }
          }
        }, 300);
      }
    };
  }

  setLanguage(newLang) {
    if (this.language === newLang) return;
    this.language = newLang;
    if (this.recognition) {
      const wasListening = this.isListening;
      this.recognition.abort();
      this.recognition.lang = newLang;
      if (wasListening) {
        setTimeout(() => {
          try { this.recognition.start(); } catch (e) {}
        }, 300);
      }
    }
  }

  start() {
    this.shouldRestart = true;
    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start();
      } catch (e) {
        console.log("Recognition already active or starting.");
      }
    }
  }

  stop() {
    this.shouldRestart = false;
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
}
