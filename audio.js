/**
 * Dynamic Web Audio API Synthesis Engine for Insight Trivia
 */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API not supported in this browser.", e);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  createOscillator(type, freq, duration, gainValues) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    // Resume context if suspended (browser security policies)
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    // Set gain values (volume envelope)
    gainNode.gain.setValueAtTime(gainValues[0], this.ctx.currentTime);
    if (gainValues.length > 1) {
      gainNode.gain.exponentialRampToValueAtTime(gainValues[1], this.ctx.currentTime + duration);
    }

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playClick() {
    // Very short click sound
    this.createOscillator("sine", 600, 0.05, [0.15, 0.01]);
  }

  playCorrect() {
    // Ascending warm chord (C5 -> E5 -> G5)
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    
    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.08);
      
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.2, now + index * 0.08 + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.35);
      
      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      
      osc.start(now + index * 0.08);
      osc.stop(now + index * 0.08 + 0.4);
    });
  }

  playIncorrect() {
    // Soft, low double-woodblock buzz (A3 -> F#3)
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [220.00, 185.00]; // A3, F#3

    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + index * 0.12);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.25, now + index * 0.12 + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * 0.12 + 0.25);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start(now + index * 0.12);
      osc.stop(now + index * 0.12 + 0.3);
    });
  }

  playAssist() {
    // Elegant sweeping chime
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C4 to C6 arpeggio
    
    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.05);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.12, now + index * 0.05 + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * 0.05 + 0.25);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start(now + index * 0.05);
      osc.stop(now + index * 0.05 + 0.3);
    });
  }

  playTick() {
    // Very subtle short woodblock sound for timer tick
    this.createOscillator("triangle", 400, 0.03, [0.08, 0.001]);
  }

  playLevelUp() {
    // Rich final chord sweep
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 587.33, 659.25, 783.99, 1046.50];
    
    notes.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.04);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.15, now + index * 0.04 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * 0.04 + 0.5);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start(now + index * 0.04);
      osc.stop(now + index * 0.04 + 0.6);
    });
  }
}

export const audioManager = new AudioManager();
