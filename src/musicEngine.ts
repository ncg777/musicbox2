import { Pcs12 } from './pcs12';
import pcsGraphData from './pcsGraphData.json';
import rhythmGraphData from './rhythmGraphData.json';

// Default constants
const DEFAULT_BPM = 45;
const MAX_VOICES = 64;
const OCTAVE_MIN = 4;
const OCTAVE_MAX = 7;
const BARS_PER_HYPERBAR = 8;
const NUM_VOICES = 2;  // Florid counterpoint with 2 voices

// User-configurable parameters with defaults
export interface EnvelopeParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface VibratoParams {
  rate: number;
  depth: number;
}

export interface TremoloParams {
  rate: number;
  depth: number;
}

// Musical duration values for delay timing
export type MusicalDuration = 
  | '2/1' | '2/1T' | '2/1D'  
  | '1/1' | '1/1T' | '1/1D'
  | '1/2' | '1/2T' | '1/2D'
  | '1/4' | '1/4T' | '1/4D'
  | '1/8' | '1/8T' | '1/8D'
  | '1/16' | '1/16T' | '1/16D'
  | '1/32' | '1/32T' | '1/32D';

export const MUSICAL_DURATIONS: MusicalDuration[] = [
  '2/1', '2/1D', '2/1T',
  '1/1', '1/1D', '1/1T',
  '1/2', '1/2D', '1/2T',
  '1/4', '1/4D', '1/4T',
  '1/8', '1/8D', '1/8T',
  '1/16', '1/16D', '1/16T',
  '1/32', '1/32D', '1/32T'
];

export type DelayFilterType = 'lowpass' | 'bandpass' | 'highpass';
export type DelayFilterOrder = 6 | 12 | 24;

export interface DelayParams {
  enabled: boolean;
  duration: MusicalDuration;
  feedback: number;  // 0 to 0.95
  mix: number;       // 0 to 1 (dry/wet)
  filterType: DelayFilterType;
  filterFrequency: number;  // Hz
  filterResonance: number;  // Q value, 0.1 to 20
  filterOrder: DelayFilterOrder;
}

export interface SynthParams {
  envelope: EnvelopeParams;
  vibrato: VibratoParams;
  tremolo: TremoloParams;
  delay: DelayParams;
  maxNoteDuration: MusicalDuration;
}

export const DEFAULT_SYNTH_PARAMS: SynthParams = {
  envelope: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.0,
    release: 0.0
  },
  vibrato: {
    rate: 4.8,
    depth: 0.003
  },
  tremolo: {
    rate: 2.1,
    depth: 0.25
  },
  delay: {
    enabled: true,
    duration: '1/2',
    feedback: 0.25,
    mix: 0.4,
    filterType: 'lowpass',
    filterFrequency: 1000,
    filterResonance: 1.0,
    filterOrder: 12
  },
  maxNoteDuration: '1/4'
};

// Convert musical duration to seconds based on BPM
export function musicalDurationToSeconds(duration: MusicalDuration, bpm: number): number {
  const beatSeconds = 60 / bpm;  // Quarter note duration
  const wholeNote = beatSeconds * 4;
  
  const baseValues: Record<string, number> = {
    '2/1': wholeNote*2,
    '1/1': wholeNote,
    '1/2': wholeNote / 2,
    '1/4': wholeNote / 4,
    '1/8': wholeNote / 8,
    '1/16': wholeNote / 16,
    '1/32': wholeNote / 32
  };
  
  // Extract base and modifier
  const base = duration.replace(/[TD]$/, '');
  const modifier = duration.slice(-1);
  
  let value = baseValues[base] || wholeNote / 4;
  
  if (modifier === 'T') {
    // Triplet: 2/3 of the base value
    value = value * (2 / 3);
  } else if (modifier === 'D') {
    // Dotted: 1.5 times the base value
    value = value * 1.5;
  }
  
  return value;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  oscillator: OscillatorNode | null;
  gainNode: GainNode | null;
  startTime: number;
  endTime: number;
}

/**
 * PCS Relation Graph for navigating between pitch class sets.
 * Uses precomputed graph data for instant initialization.
 */
class PcsRelationGraph {
  private nodes: Pcs12[];
  private adjacency: number[][];
  private currentIndex: number;

  constructor() {
    // Load precomputed data
    this.nodes = pcsGraphData.nodes.map(str => Pcs12.fromBinaryString(str));
    this.adjacency = pcsGraphData.adjacency;
    this.currentIndex = Math.floor(Math.random() * this.nodes.length);
  }

  current(): Pcs12 {
    return this.nodes[this.currentIndex];
  }

  advance(): void {
    if (this.nodes.length === 0) return;

    const neighbors = this.adjacency[this.currentIndex];
    if (neighbors.length > 0) {
      this.currentIndex = neighbors[Math.floor(Math.random() * neighbors.length)];
      return;
    }
    
    this.currentIndex = Math.floor(Math.random() * this.nodes.length);
  }
}

/**
 * Rhythm Relation Graph for navigating between rhythms.
 * Uses precomputed graph data from 8-hex rhythm pairs.
 */
class RhythmRelationGraph {
  private nodes: string[];  // 4-hex rhythm strings
  private adjacency: number[][];
  private currentIndex: number;

  constructor() {
    this.nodes = rhythmGraphData.nodes;
    this.adjacency = rhythmGraphData.adjacency;
    this.currentIndex = Math.floor(Math.random() * this.nodes.length);
  }

  /**
   * Perform a random walk of specified length and return the sequence of rhythms
   */
  randomWalk(length: number): string[] {
    if (this.nodes.length === 0) return [];
    
    const walk: string[] = [];
    let currentIdx = this.currentIndex;
    
    for (let i = 0; i < length; i++) {
      walk.push(this.nodes[currentIdx]);
      
      const neighbors = this.adjacency[currentIdx];
      if (neighbors.length > 0) {
        currentIdx = neighbors[Math.floor(Math.random() * neighbors.length)];
      } else {
        // If no neighbors, jump to a random node
        currentIdx = Math.floor(Math.random() * this.nodes.length);
      }
    }
    
    // Update current position for next walk
    this.currentIndex = currentIdx;
    
    return walk;
  }

  /**
   * Get a random starting node
   */
  randomize(): void {
    this.currentIndex = Math.floor(Math.random() * this.nodes.length);
  }
}

/**
 * Parse a 4-hex rhythm string into an array of 16th-note onset positions (0-15)
 * Each hex digit represents 4 bits (4 16th notes per beat, 4 beats per bar)
 */
function parseRhythmHex(hexString: string): number[] {
  const onsets: number[] = [];
  for (let i = 0; i < 4; i++) {
    const hexDigit = parseInt(hexString[i], 16);
    for (let bit = 3; bit >= 0; bit--) {
      if ((hexDigit >> bit) & 1) {
        const position = i * 4 + (3 - bit);
        onsets.push(position);
      }
    }
  }
  return onsets;
}

/**
 * Main music engine using Web Audio API directly.
 */
export class MusicEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayFilters: BiquadFilterNode[] = [];
  private delayDryGain: GainNode | null = null;
  private delayWetGain: GainNode | null = null;
  private delayInputGain: GainNode | null = null;
  private isPlaying: boolean = false;
  private pcsGraph: PcsRelationGraph;
  private rhythmGraph: RhythmRelationGraph;
  private activePitchClasses: number[] = [];
  private voices: Voice[] = [];
  private schedulerId: number | null = null;
  private synthParams: SynthParams = JSON.parse(JSON.stringify(DEFAULT_SYNTH_PARAMS));
  
  // Timing parameters
  private bpm: number = DEFAULT_BPM;
  
  // Hyperbar and rhythm scheduling
  private hyperbarStartTime: number = 0;
  private currentHyperbarRhythms: string[] = [];  // 8 rhythms for current hyperbar
  private currentHyperbarChords: Pcs12[] = [];  // 8 chords for current hyperbar (synced with rhythms)
  private scheduledNoteIndex: number = 0;  // Index into scheduled notes for current hyperbar
  private scheduledNotes: { time: number; barIndex: number; voiceIndex: number }[] = [];  // Pre-scheduled note times with voice
  
  // Octave tracking for smooth evolution (one per voice for counterpoint)
  private currentOctaves: number[] = [];
  
  // Current bar tracking for chord changes
  private currentBarIndex: number = 0;
  
  // Strumming pattern state for voice 0
  private strumPatternIndex: number = 0;  // Current position in strum pattern
  private currentStrumPattern: number[] = [];  // Current strum pattern (indices into chord)
  
  // Callbacks
  onChordChange?: (chord: string) => void;
  onNoteTriggered?: (pitchClass: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;

  constructor() {
    this.pcsGraph = new PcsRelationGraph();
    this.rhythmGraph = new RhythmRelationGraph();
    // Initialize octaves for each voice at different starting positions
    this.currentOctaves = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      // Spread voices across the octave range
      const baseOctave = Math.floor((OCTAVE_MIN + OCTAVE_MAX) / 2);
      this.currentOctaves.push(baseOctave + (i === 0 ? 0 : 1));  // Voice 0 lower, Voice 1 higher
    }
    this.setupMediaSession();
  }

  // Computed timing values
  private get sixteenthSeconds(): number {
    return (60 / this.bpm) / 4;
  }

  private get barSeconds(): number {
    return 4 * (60 / this.bpm);
  }

  private get hyperbarSeconds(): number {
    return this.barSeconds * BARS_PER_HYPERBAR;
  }

  private setupMediaSession(): void {
    if ('mediaSession' in navigator) {
      const assetPath = (file: string) => `${import.meta.env.BASE_URL}${file}`;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'musicbox2',
        artist: 'ncg777',
        album: 'ncg777 musicbox2',
        artwork: [
          { src: assetPath('pwa-192x192.svg'), sizes: '192x192', type: 'image/svg+xml' },
          { src: assetPath('pwa-512x512.svg'), sizes: '512x512', type: 'image/svg+xml' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => {
        this.start();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        this.stop();
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        this.stop();
      });
    }
  }

  private updateMediaSessionState(): void {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
    }
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(20, Math.min(300, bpm)); // Clamp to reasonable range
  }

  getBpm(): number {
    return this.bpm;
  }

  setSynthParams(params: Partial<SynthParams>): void {
    if (params.envelope) {
      this.synthParams.envelope = { ...this.synthParams.envelope, ...params.envelope };
    }
    if (params.vibrato) {
      this.synthParams.vibrato = { ...this.synthParams.vibrato, ...params.vibrato };
    }
    if (params.tremolo) {
      this.synthParams.tremolo = { ...this.synthParams.tremolo, ...params.tremolo };
    }
    if (params.delay) {
      this.synthParams.delay = { ...this.synthParams.delay, ...params.delay };
      this.updateDelayParams();
    }
    if (params.maxNoteDuration !== undefined) {
      this.synthParams.maxNoteDuration = params.maxNoteDuration;
    }
  }

  private updateDelayParams(): void {
    if (!this.audioContext) return;
    
    const { enabled, duration, feedback, mix, filterType, filterFrequency, filterResonance, filterOrder } = this.synthParams.delay;
    
    // Update delay time
    if (this.delayNode) {
      const delaySeconds = musicalDurationToSeconds(duration, this.bpm);
      this.delayNode.delayTime.setTargetAtTime(delaySeconds, this.audioContext.currentTime, 0.05);
    }
    
    // Update feedback gain
    if (this.delayFeedbackGain) {
      this.delayFeedbackGain.gain.setTargetAtTime(
        enabled ? Math.min(feedback, 0.95) : 0,
        this.audioContext.currentTime,
        0.05
      );
    }
    
    // Update dry/wet mix
    if (this.delayDryGain && this.delayWetGain) {
      this.delayDryGain.gain.setTargetAtTime(1 - (enabled ? mix : 0), this.audioContext.currentTime, 0.05);
      this.delayWetGain.gain.setTargetAtTime(enabled ? mix : 0, this.audioContext.currentTime, 0.05);
    }
    
    // Update filters
    this.updateDelayFilters(filterType, filterFrequency, filterResonance, filterOrder);
  }

  private updateDelayFilters(type: DelayFilterType, frequency: number, resonance: number, order: DelayFilterOrder): void {
    if (!this.audioContext) return;
    
    const numFilters = order / 6;  // 6dB per filter stage
    
    // If we need to recreate filters (different count)
    if (this.delayFilters.length !== numFilters) {
      this.recreateDelayFilterChain(type, frequency, resonance, numFilters);
      return;
    }
    
    // Just update existing filter params
    for (const filter of this.delayFilters) {
      filter.type = type;
      filter.frequency.setTargetAtTime(frequency, this.audioContext.currentTime, 0.05);
      filter.Q.setTargetAtTime(resonance, this.audioContext.currentTime, 0.05);
    }
  }

  private recreateDelayFilterChain(type: DelayFilterType, frequency: number, resonance: number, numFilters: number): void {
    if (!this.audioContext || !this.delayNode || !this.delayFeedbackGain || !this.delayWetGain) return;
    
    // Disconnect old filters
    for (const filter of this.delayFilters) {
      try { filter.disconnect(); } catch (e) {}
    }
    
    // Create new filters
    this.delayFilters = [];
    for (let i = 0; i < numFilters; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = resonance;
      this.delayFilters.push(filter);
    }
    
    // Reconnect: delayNode -> filters -> feedbackGain & wetGain
    try {
      this.delayNode.disconnect();
    } catch (e) {}
    
    if (this.delayFilters.length > 0) {
      this.delayNode.connect(this.delayFilters[0]);
      for (let i = 0; i < this.delayFilters.length - 1; i++) {
        this.delayFilters[i].connect(this.delayFilters[i + 1]);
      }
      const lastFilter = this.delayFilters[this.delayFilters.length - 1];
      lastFilter.connect(this.delayFeedbackGain);
      lastFilter.connect(this.delayWetGain);
    } else {
      this.delayNode.connect(this.delayFeedbackGain);
      this.delayNode.connect(this.delayWetGain);
    }
  }

  getSynthParams(): SynthParams {
    return { ...this.synthParams };
  }

  /**
   * Generate a new hyperbar: perform random walks of 5 for both rhythms and chords,
   * arrange them as [3, 2, 1, 0, 1, 2, 3, 4] for 8 bars (synchronized)
   */
  private generateHyperbar(): void {
    // Generate rhythm sequence
    const walkRhythms = this.rhythmGraph.randomWalk(5);
    
    if (walkRhythms.length < 5) {
      // Fallback if graph is too sparse
      console.warn('Rhythm walk too short, using defaults');
      this.currentHyperbarRhythms = Array(8).fill(walkRhythms[0] || '8000');
    } else {
      // Arrange as: r3, r2, r1, r0, r1, r2, r3, r4
      const [r0, r1, r2, r3, r4] = walkRhythms;
      this.currentHyperbarRhythms = [r3, r2, r1, r0, r1, r2, r3, r4];
    }
    
    // Generate chord sequence (same pattern: c3, c2, c1, c0, c1, c2, c3, c4)
    const chordWalk: Pcs12[] = [];
    for (let i = 0; i < 5; i++) {
      chordWalk.push(this.pcsGraph.current());
      this.pcsGraph.advance();
    }
    const [c0, c1, c2, c3, c4] = chordWalk;
    this.currentHyperbarChords = [c3, c2, c1, c0, c1, c2, c3, c4];
    
    // Reset bar index
    this.currentBarIndex = -1;  // Will be set to 0 on first note
  }

  /**
   * Pre-schedule all note times for the current hyperbar (with 2-voice counterpoint)
   */
  private scheduleHyperbarNotes(startTime: number): void {
    this.scheduledNotes = [];
    
    for (let barIndex = 0; barIndex < BARS_PER_HYPERBAR; barIndex++) {
      const rhythmHex = this.currentHyperbarRhythms[barIndex];
      const onsets = parseRhythmHex(rhythmHex);
      const barStartTime = startTime + barIndex * this.barSeconds;
      
      for (const onset of onsets) {
        const noteTime = barStartTime + onset * this.sixteenthSeconds;
        // Schedule notes for each voice (florid counterpoint)
        for (let voiceIndex = 0; voiceIndex < NUM_VOICES; voiceIndex++) {
          // Add slight timing offset for second voice to create more florid texture
          const voiceOffset = voiceIndex * this.sixteenthSeconds * 0.25;  // 25% of 16th note
          this.scheduledNotes.push({ 
            time: noteTime + voiceOffset, 
            barIndex, 
            voiceIndex 
          });
        }
      }
    }
    
    // Sort by time
    this.scheduledNotes.sort((a, b) => a.time - b.time);
    this.scheduledNoteIndex = 0;
  }

  private refreshPitchClasses(barIndex: number): void {
    if (barIndex >= 0 && barIndex < this.currentHyperbarChords.length) {
      const chord = this.currentHyperbarChords[barIndex];
      this.activePitchClasses = chord.asSequence();
      
      // Generate a new strumming pattern for this chord
      this.generateStrumPattern();
      
      if (this.onChordChange) {
        this.onChordChange(chord.toString());
      }
    }
  }

  /**
   * Generate a strumming pattern for the current chord.
   * Creates musical patterns like guitar strumming with varied directions and note groupings.
   */
  private generateStrumPattern(): void {
    const n = this.activePitchClasses.length;
    if (n === 0) {
      this.currentStrumPattern = [];
      this.strumPatternIndex = 0;
      return;
    }

    // Different strumming pattern types
    const patternType = Math.floor(Math.random() * 6);
    const pattern: number[] = [];
    
    switch (patternType) {
      case 0:
        // Down strum (low to high)
        for (let i = 0; i < n; i++) pattern.push(i);
        // Up strum (high to low)
        for (let i = n - 1; i >= 0; i--) pattern.push(i);
        break;
        
      case 1:
        // Alternating bass + chord strum pattern
        // Bass note, then upper notes, repeat with variation
        pattern.push(0);  // Bass
        for (let i = Math.floor(n / 2); i < n; i++) pattern.push(i);  // Upper
        pattern.push(n > 1 ? 1 : 0);  // Second bass
        for (let i = Math.floor(n / 2); i < n; i++) pattern.push(i);  // Upper again
        break;
        
      case 2:
        // Broken chord with skips (more elaborate)
        for (let i = 0; i < n; i += 2) pattern.push(i);  // Odds
        for (let i = n - 1; i >= 0; i -= 2) pattern.push(i);  // Evens reverse
        for (let i = 1; i < n; i += 2) pattern.push(i);  // Evens
        break;
        
      case 3:
        // Pendulum pattern (outside to inside to outside)
        for (let i = 0; i < Math.ceil(n / 2); i++) {
          pattern.push(i);
          if (n - 1 - i !== i) pattern.push(n - 1 - i);
        }
        for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
          pattern.push(i);
          if (n - 1 - i !== i) pattern.push(n - 1 - i);
        }
        break;
        
      case 4:
        // Cascading down with repeated top note
        for (let rep = 0; rep < 2; rep++) {
          pattern.push(n - 1);  // Top note
          for (let i = n - 2; i >= 0; i--) pattern.push(i);
        }
        break;
        
      case 5:
        // Travis picking style (bass alternates with melody)
        const bassNotes = [0, n > 2 ? 1 : 0];
        const melodyNotes = n > 2 ? [n - 1, n - 2, n - 1] : [n - 1];
        for (let i = 0; i < 4; i++) {
          pattern.push(bassNotes[i % 2]);
          if (i < melodyNotes.length) pattern.push(melodyNotes[i]);
        }
        break;
    }
    
    this.currentStrumPattern = pattern;
    this.strumPatternIndex = 0;
  }

  private createDelayMixNode(): GainNode | null {
    if (!this.audioContext || !this.delayDryGain || !this.delayWetGain) return null;
    
    const mixNode = this.audioContext.createGain();
    mixNode.gain.value = 1.0;
    this.delayDryGain.connect(mixNode);
    this.delayWetGain.connect(mixNode);
    return mixNode;
  }

  private createDelayEffect(): void {
    if (!this.audioContext || !this.masterGain) return;
    
    const { enabled, duration, feedback, mix, filterType, filterFrequency, filterResonance, filterOrder } = this.synthParams.delay;
    const delaySeconds = musicalDurationToSeconds(duration, this.bpm);
    
    // Create delay node (max 5 seconds for whole notes at slow tempos)
    this.delayNode = this.audioContext.createDelay(5.0);
    this.delayNode.delayTime.value = delaySeconds;
    
    // Create feedback gain
    this.delayFeedbackGain = this.audioContext.createGain();
    this.delayFeedbackGain.gain.value = enabled ? Math.min(feedback, 0.95) : 0;
    
    // Create dry/wet gains
    this.delayDryGain = this.audioContext.createGain();
    this.delayWetGain = this.audioContext.createGain();
    this.delayDryGain.gain.value = 1 - (enabled ? mix : 0);
    this.delayWetGain.gain.value = enabled ? mix : 0;
    
    // Create input gain for delay line
    this.delayInputGain = this.audioContext.createGain();
    this.delayInputGain.gain.value = 1.0;
    
    // Create filter chain
    const numFilters = filterOrder / 6;
    this.delayFilters = [];
    for (let i = 0; i < numFilters; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFrequency;
      filter.Q.value = filterResonance;
      this.delayFilters.push(filter);
    }
    
    // Connect the delay chain:
    // masterGain -> delayDryGain (dry path)
    // masterGain -> delayInputGain -> delayNode -> filters -> delayWetGain (wet path)
    //                                           -> filters -> delayFeedbackGain -> delayInputGain (feedback loop)
    
    this.masterGain.connect(this.delayDryGain);
    this.masterGain.connect(this.delayInputGain);
    this.delayInputGain.connect(this.delayNode);
    
    if (this.delayFilters.length > 0) {
      this.delayNode.connect(this.delayFilters[0]);
      for (let i = 0; i < this.delayFilters.length - 1; i++) {
        this.delayFilters[i].connect(this.delayFilters[i + 1]);
      }
      const lastFilter = this.delayFilters[this.delayFilters.length - 1];
      lastFilter.connect(this.delayFeedbackGain);
      lastFilter.connect(this.delayWetGain);
    } else {
      this.delayNode.connect(this.delayFeedbackGain);
      this.delayNode.connect(this.delayWetGain);
    }
    
    this.delayFeedbackGain.connect(this.delayInputGain);
  }

  private createSimpleReverb(): ConvolverNode | null {
    if (!this.audioContext) return null;
    
    try {
      const convolver = this.audioContext.createConvolver();
      const rate = this.audioContext.sampleRate;
      const length = rate * 3; // 3 second reverb tail
      const impulse = this.audioContext.createBuffer(2, length, rate);
      
      // Create a more natural sounding reverb impulse response
      const decay = 2.5; // decay time constant
      
      for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const t = i / rate;
          // Exponential decay envelope
          const envelope = Math.exp(-t / decay);
          // Add some early reflections
          let early = 0;
          if (i < rate * 0.1) {
            // Early reflections in first 100ms
            const delays = [0.01, 0.023, 0.037, 0.052, 0.068, 0.083];
            for (const d of delays) {
              if (Math.abs(t - d) < 0.001) {
                early = (Math.random() * 2 - 1) * 0.5;
              }
            }
          }
          // Diffuse late reverb with filtered noise
          const noise = (Math.random() * 2 - 1) * envelope * 0.3;
          channelData[i] = early + noise;
        }
      }
      
      convolver.buffer = impulse;
      return convolver;
    } catch (e) {
      console.warn('Failed to create reverb:', e);
      return null;
    }
  }

  private cleanupOldVoices(): void {
    if (!this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    this.voices = this.voices.filter(voice => {
      if (voice.endTime < now - 0.5) {
        // Voice has finished, clean up
        try {
          if (voice.oscillator) {
            voice.oscillator.disconnect();
          }
          if (voice.gainNode) {
            voice.gainNode.disconnect();
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        return false;
      }
      return true;
    });
  }

  private triggerNote(frequency: number, when: number, duration: number): void {
    if (!this.audioContext || !this.masterGain) return;
    
    // Clean up old voices first
    this.cleanupOldVoices();
    
    // Limit active voices
    if (this.voices.length >= MAX_VOICES) {
      // Remove oldest voice
      const oldest = this.voices.shift();
      if (oldest) {
        try {
          if (oldest.oscillator) {
            oldest.oscillator.stop();
            oldest.oscillator.disconnect();
          }
          if (oldest.gainNode) {
            oldest.gainNode.disconnect();
          }
        } catch (e) {
          // Ignore
        }
      }
    }

    const { attack, decay, sustain, release } = this.synthParams.envelope;
    const { rate: vibratoRate, depth: vibratoDepth } = this.synthParams.vibrato;
    const { rate: tremoloRate, depth: tremoloDepth } = this.synthParams.tremolo;
    
    // Create main oscillator
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, when);
    
    // Create vibrato (frequency modulation) using LFO
    const vibratoLFO = this.audioContext.createOscillator();
    const vibratoGain = this.audioContext.createGain();
    vibratoLFO.type = 'sine';
    vibratoLFO.frequency.setValueAtTime(vibratoRate, when);
    // Vibrato depth is in semitones, convert to frequency deviation
    vibratoGain.gain.setValueAtTime(frequency * vibratoDepth, when);
    vibratoLFO.connect(vibratoGain);
    vibratoGain.connect(oscillator.frequency);
    
    // Create tremolo (amplitude modulation) using LFO
    const tremoloLFO = this.audioContext.createOscillator();
    const tremoloGain = this.audioContext.createGain();
    const tremoloDepthNode = this.audioContext.createGain();
    tremoloLFO.type = 'sine';
    tremoloLFO.frequency.setValueAtTime(tremoloRate, when);
    // Tremolo oscillates between (1 - depth) and 1
    tremoloGain.gain.setValueAtTime(1 - tremoloDepth / 2, when);
    tremoloDepthNode.gain.setValueAtTime(tremoloDepth / 2, when);
    tremoloLFO.connect(tremoloDepthNode);
    
    // Create gain for envelope
    const envelopeGain = this.audioContext.createGain();
    envelopeGain.gain.setValueAtTime(0, when);
    
    // ADSR envelope
    const peakTime = when + attack;
    const decayEndTime = peakTime + decay;
    const releaseStartTime = when + duration;
    const releaseEndTime = releaseStartTime + release;
    
    // Attack
    envelopeGain.gain.linearRampToValueAtTime(0.3, peakTime);
    // Decay to sustain
    envelopeGain.gain.linearRampToValueAtTime(0.3 * sustain, decayEndTime);
    // Hold sustain until release
    envelopeGain.gain.setValueAtTime(0.3 * sustain, releaseStartTime);
    // Release
    envelopeGain.gain.linearRampToValueAtTime(0, releaseEndTime);
    
    // Connect chain: oscillator -> envelope -> tremolo mix -> master
    oscillator.connect(envelopeGain);
    envelopeGain.connect(tremoloGain);
    tremoloDepthNode.connect(tremoloGain.gain);
    tremoloGain.connect(this.masterGain);
    
    // Start oscillators
    oscillator.start(when);
    vibratoLFO.start(when);
    tremoloLFO.start(when);
    
    // Stop oscillators
    oscillator.stop(releaseEndTime + 0.1);
    vibratoLFO.stop(releaseEndTime + 0.1);
    tremoloLFO.stop(releaseEndTime + 0.1);
    
    // Track the voice
    this.voices.push({
      oscillator,
      gainNode: envelopeGain,
      startTime: when,
      endTime: releaseEndTime
    });
  }

  private triggerRandomNote(whenTime: number, voiceIndex: number, barIndex: number): void {
    // Update chord if bar changed
    if (barIndex !== this.currentBarIndex) {
      this.currentBarIndex = barIndex;
      this.refreshPitchClasses(barIndex);
    }
    
    if (this.activePitchClasses.length === 0) {
      return;
    }

    let pitchClass: number;
    
    if (voiceIndex === 0 && this.currentStrumPattern.length > 0) {
      // Voice 0: Strumming pattern - follow the generated pattern
      const chordIndex = this.currentStrumPattern[this.strumPatternIndex];
      pitchClass = this.activePitchClasses[Math.min(chordIndex, this.activePitchClasses.length - 1)];
      
      // Advance through the strum pattern
      this.strumPatternIndex = (this.strumPatternIndex + 1) % this.currentStrumPattern.length;
    } else {
      // Voice 1+: Random florid counterpoint
      pitchClass = this.activePitchClasses[
        Math.floor(Math.random() * this.activePitchClasses.length)
      ];
    }
    
    // Smooth octave evolution per voice: change by at most 1
    const octaveChange = Math.floor(Math.random() * 3) - 1;  // -1, 0, or 1
    this.currentOctaves[voiceIndex] = Math.max(
      OCTAVE_MIN, 
      Math.min(OCTAVE_MAX, this.currentOctaves[voiceIndex] + octaveChange)
    );
    
    const octave = this.currentOctaves[voiceIndex];
    const midi = octave * 12 + pitchClass;
    const frequency = midiToFreq(midi);
    const maxDurationSeconds = musicalDurationToSeconds(this.synthParams.maxNoteDuration, this.bpm);
    const duration = maxDurationSeconds * (0.5 + Math.random() * 0.5);

    console.log('Triggering note:', { voice: voiceIndex, pitchClass, octave, frequency: frequency.toFixed(1), whenTime: whenTime.toFixed(2) });
    
    this.triggerNote(frequency, whenTime, duration);
    
    if (this.onNoteTriggered) {
      this.onNoteTriggered(pitchClass);
    }
  }

  private scheduler(): void {
    if (!this.isPlaying || !this.audioContext) {
      return;
    }

    const currentTime = this.audioContext.currentTime;
    const lookAhead = 0.2; // 200ms lookahead

    // Check if we need to start a new hyperbar
    if (currentTime >= this.hyperbarStartTime + this.hyperbarSeconds - lookAhead) {
      const newHyperbarStart = this.hyperbarStartTime + this.hyperbarSeconds;
      this.hyperbarStartTime = newHyperbarStart;
      this.generateHyperbar();
      this.scheduleHyperbarNotes(newHyperbarStart);
      console.log('New hyperbar:', this.currentHyperbarRhythms);
    }

    // Check for note events from the scheduled notes
    while (this.scheduledNoteIndex < this.scheduledNotes.length) {
      const note = this.scheduledNotes[this.scheduledNoteIndex];
      if (note.time <= currentTime + lookAhead) {
        const noteTime = Math.max(note.time, currentTime + 0.02);
        this.triggerRandomNote(noteTime, note.voiceIndex, note.barIndex);
        this.scheduledNoteIndex++;
      } else {
        break;
      }
    }

    // Schedule next check
    this.schedulerId = window.setTimeout(() => this.scheduler(), 50);
  }

  async start(): Promise<void> {
    if (this.isPlaying) return;

    try {
      console.log('Creating AudioContext...');
      
      // Create or resume audio context
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      console.log('AudioContext state:', this.audioContext.state);

      // Create master gain
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.5;
      
      // Create delay effect
      this.createDelayEffect();
      
      // Create reverb
      this.reverbNode = this.createSimpleReverb();
      
      // Get the output of the delay effect (or master if no delay)
      const delayOutput = this.delayDryGain && this.delayWetGain ? null : this.masterGain;
      const signalSource = delayOutput || this.createDelayMixNode();
      
      if (this.reverbNode && signalSource) {
        // Dry/wet mix: 70% dry, 30% wet
        const dryGain = this.audioContext.createGain();
        const wetGain = this.audioContext.createGain();
        dryGain.gain.value = 0.7;
        wetGain.gain.value = 0.3;
        
        signalSource.connect(dryGain);
        signalSource.connect(this.reverbNode);
        this.reverbNode.connect(wetGain);
        
        dryGain.connect(this.audioContext.destination);
        wetGain.connect(this.audioContext.destination);
      } else if (signalSource) {
        // No reverb, connect directly
        signalSource.connect(this.audioContext.destination);
      }
      
      console.log('Audio chain ready');

      // Set initial timing
      const startTime = this.audioContext.currentTime;
      this.hyperbarStartTime = startTime;
      
      // Reset octaves for each voice
      for (let i = 0; i < NUM_VOICES; i++) {
        const baseOctave = Math.floor((OCTAVE_MIN + OCTAVE_MAX) / 2);
        this.currentOctaves[i] = baseOctave + (i === 0 ? 0 : 1);
      }
      
      // Reset bar index
      this.currentBarIndex = -1;
      
      // Generate first hyperbar and schedule its notes
      this.generateHyperbar();
      this.scheduleHyperbarNotes(startTime);
      
      // Initialize pitch classes from first chord
      this.refreshPitchClasses(0);
      console.log('Initial pitch classes:', this.activePitchClasses);
      console.log('Initial hyperbar rhythms:', this.currentHyperbarRhythms);
      console.log('Initial hyperbar chords:', this.currentHyperbarChords.map(c => c.toString()));

      this.isPlaying = true;
      this.updateMediaSessionState();
      if (this.onPlayStateChange) {
        this.onPlayStateChange(true);
      }
      
      console.log('Starting scheduler');
      this.scheduler();
    } catch (error) {
      console.error('Failed to start audio engine:', error);
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.isPlaying = false;

    if (this.schedulerId !== null) {
      clearTimeout(this.schedulerId);
      this.schedulerId = null;
    }

    // Stop all voices
    for (const voice of this.voices) {
      try {
        if (voice.oscillator) {
          voice.oscillator.stop();
          voice.oscillator.disconnect();
        }
        if (voice.gainNode) {
          voice.gainNode.disconnect();
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    this.voices = [];

    // Disconnect nodes
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch (e) {}
      this.masterGain = null;
    }
    
    // Disconnect delay nodes
    if (this.delayNode) {
      try { this.delayNode.disconnect(); } catch (e) {}
      this.delayNode = null;
    }
    if (this.delayFeedbackGain) {
      try { this.delayFeedbackGain.disconnect(); } catch (e) {}
      this.delayFeedbackGain = null;
    }
    if (this.delayDryGain) {
      try { this.delayDryGain.disconnect(); } catch (e) {}
      this.delayDryGain = null;
    }
    if (this.delayWetGain) {
      try { this.delayWetGain.disconnect(); } catch (e) {}
      this.delayWetGain = null;
    }
    if (this.delayInputGain) {
      try { this.delayInputGain.disconnect(); } catch (e) {}
      this.delayInputGain = null;
    }
    for (const filter of this.delayFilters) {
      try { filter.disconnect(); } catch (e) {}
    }
    this.delayFilters = [];
    
    if (this.reverbNode) {
      try {
        this.reverbNode.disconnect();
      } catch (e) {}
      this.reverbNode = null;
    }

    // Suspend audio context to save resources
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }

    this.updateMediaSessionState();
    if (this.onPlayStateChange) {
      this.onPlayStateChange(false);
    }
  }

  toggle(): Promise<void> {
    if (this.isPlaying) {
      this.stop();
      return Promise.resolve();
    } else {
      return this.start();
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
