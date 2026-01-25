import { Pcs12 } from './pcs12';
import rhythmGraphData from './rhythmGraphData.json';

// Bebop scale: 8-23.00 = pitches 0,1,2,3,5,7,8,10
// For 8-23.X, KEY = X - 4
const BEBOP_SCALE_BASE = [0, 1, 2, 3, 5, 7, 8, 10];

/**
 * Get the bebop scale rotated by the given amount (transposition).
 * Returns the pitch classes of the rotated scale.
 */
function getBebopScale(rotation: number): number[] {
  return BEBOP_SCALE_BASE.map(pc => (pc + rotation + 12) % 12).sort((a, b) => a - b);
}

/**
 * Get the KEY for a given bebop scale rotation.
 * KEY = rotation - 4 (mod 12)
 */
function getKeyFromRotation(rotation: number): number {
  return ((rotation - 4) % 12 + 12) % 12;
}

/**
 * Generate all subsets of a given size from the scale pitches.
 * Filters out dissonant chords (those with minor second intervals).
 */
function generateSubsets(scale: number[], size: number): Pcs12[] {
  const subsets: Pcs12[] = [];
  const n = scale.length;
  
  // Generate all combinations of 'size' elements from scale
  function combine(start: number, current: number[]): void {
    if (current.length === size) {
      const pcs = new Pcs12(new Set(current));
      // Filter out chords with minor second intervals (interval vector position 0 > 0)
      const iv = pcs.getIntervalVector();
      if (iv[0] === 0) {  // No minor seconds
        subsets.push(pcs);
      }
      return;
    }
    for (let i = start; i < n; i++) {
      combine(i + 1, [...current, scale[i]]);
    }
  }
  
  combine(0, []);
  return subsets;
}

/**
 * Compare two Pcs12 after rotating by KEY for sorting.
 * This sorts chords relative to the current key center.
 */
function comparePcsByKey(a: Pcs12, b: Pcs12, key: number): number {
  const aRotated = a.rotate(-key);  // Rotate to key-relative position
  const bRotated = b.rotate(-key);
  const aSeq = aRotated.asSequence();
  const bSeq = bRotated.asSequence();
  
  // Compare as sequences (lexicographic)
  for (let i = 0; i < Math.min(aSeq.length, bSeq.length); i++) {
    if (aSeq[i] !== bSeq[i]) {
      return aSeq[i] - bSeq[i];
    }
  }
  return aSeq.length - bSeq.length;
}

// Default constants
const DEFAULT_BPM = 45;
const MAX_VOICES = 64;
const OCTAVE_MIN = 4;
const OCTAVE_MAX = 7;
const BARS_PER_HYPERBAR = 8;
const BEATS_PER_BAR = 4;

// Hawkes process parameters (bar-relative, scales with BPM)
const HAWKES_BASE_RATE = 8.0;  // Base intensity (notes per bar)
const HAWKES_EXCITATION = 3.2;  // Jump in intensity after each event
const HAWKES_DECAY = 12.0;  // Decay rate of excitation (per bar)

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
  private rhythmGraph: RhythmRelationGraph;
  private activePitchClasses: number[] = [];
  private voices: Voice[] = [];
  private schedulerId: number | null = null;
  private synthParams: SynthParams = JSON.parse(JSON.stringify(DEFAULT_SYNTH_PARAMS));
  
  // Bebop scale state
  private currentScaleRotation: number = 0;  // Current bebop scale rotation (0-11)
  private currentScale: number[] = BEBOP_SCALE_BASE;  // Current scale pitches
  private currentKey: number = 0;  // KEY = rotation - 4
  
  // Timing parameters
  private bpm: number = DEFAULT_BPM;
  
  // Hawkes process parameters (user-configurable)
  private hawkesBaseRate: number = HAWKES_BASE_RATE;
  private hawkesExcitation: number = HAWKES_EXCITATION;
  private hawkesDecay: number = HAWKES_DECAY;
  
  // Hyperbar and rhythm scheduling
  private hyperbarStartTime: number = 0;
  private currentHyperbarRhythms: string[] = [];  // 8 rhythms for current hyperbar
  private currentHyperbarChords: Pcs12[] = [];  // 8 chords for current hyperbar (synced with rhythms)
  
  // Hawkes process state
  private hawkesEventTimes: number[] = [];  // Recent event times for calculating excitation
  private nextHawkesCheckTime: number = 0;  // Next time to check for Hawkes event
  private currentRhythmOnsets: number[] = [];  // Current bar's rhythm onsets as absolute times
  
  // Octave tracking for smooth evolution
  private currentOctave: number = 5;
  
  // Current bar tracking for chord changes
  private currentBarIndex: number = 0;
  
  // Callbacks
  onChordChange?: (chord: string) => void;
  onNoteTriggered?: (pitchClass: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;

  constructor() {
    this.rhythmGraph = new RhythmRelationGraph();
    // Initialize bebop scale at a random rotation
    this.currentScaleRotation = Math.floor(Math.random() * 12);
    this.currentScale = getBebopScale(this.currentScaleRotation);
    this.currentKey = getKeyFromRotation(this.currentScaleRotation);
    // Initialize octave in the middle of the range
    this.currentOctave = Math.floor((OCTAVE_MIN + OCTAVE_MAX) / 2);
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

  setHawkesBaseRate(rate: number): void {
    this.hawkesBaseRate = Math.max(0.5, Math.min(40, rate)); // Clamp to reasonable range (notes per bar)
  }

  getHawkesBaseRate(): number {
    return this.hawkesBaseRate;
  }

  setHawkesExcitation(excitation: number): void {
    this.hawkesExcitation = Math.max(0, Math.min(20, excitation)); // Clamp to reasonable range
  }

  getHawkesExcitation(): number {
    return this.hawkesExcitation;
  }

  setHawkesDecay(decay: number): void {
    this.hawkesDecay = Math.max(0.5, Math.min(80, decay)); // Clamp to reasonable range (per bar)
  }

  getHawkesDecay(): number {
    return this.hawkesDecay;
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
   * Generate a new hyperbar using bebop scale-based chord generation.
   * - Rotate the bebop scale a fifth up or down
   * - Generate 4 random subset chords from the current scale
   * - Sort them by KEY, then use sequence [0,2,3,1]
   * - Each chord lasts 2 bars (4 chords × 2 bars = 8 bars)
   */
  private generateHyperbar(): void {
    // Rotate the bebop scale a fifth up or down (±7 semitones)
    const direction = Math.random() < 0.5 ? 7 : -7;
    this.currentScaleRotation = ((this.currentScaleRotation + direction) % 12 + 12) % 12;
    this.currentScale = getBebopScale(this.currentScaleRotation);
    this.currentKey = getKeyFromRotation(this.currentScaleRotation);
    
    console.log('New bebop scale rotation:', this.currentScaleRotation, 'KEY:', this.currentKey, 'Scale:', this.currentScale);
    
    // Generate rhythm sequence (still using the walk pattern)
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
    
    // Generate 4 random subset chords from the current bebop scale
    // Use 3-5 note chords for variety
    const chordSizes = [3, 4, 4, 5];  // Mix of chord sizes
    const allSubsets: Pcs12[][] = chordSizes.map(size => generateSubsets(this.currentScale, size));
    
    // Pick 4 random chords (one from each size category for variety)
    const fourChords: Pcs12[] = [];
    for (let i = 0; i < 4; i++) {
      const subsets = allSubsets[i];
      if (subsets.length > 0) {
        fourChords.push(subsets[Math.floor(Math.random() * subsets.length)]);
      } else {
        // Fallback: use the full scale
        fourChords.push(new Pcs12(new Set(this.currentScale)));
      }
    }
    
    // Sort chords by KEY (rotate by -KEY before comparison)
    fourChords.sort((a, b) => comparePcsByKey(a, b, this.currentKey));
    
    // Use sequence [0, 2, 3, 1] to determine chord order
    const chordSequence = [
      fourChords[0],
      fourChords[2],
      fourChords[3],
      fourChords[1]
    ];
    
    // Each chord lasts 2 bars: [c0, c0, c1, c1, c2, c2, c3, c3]
    this.currentHyperbarChords = [
      chordSequence[0], chordSequence[0],
      chordSequence[1], chordSequence[1],
      chordSequence[2], chordSequence[2],
      chordSequence[3], chordSequence[3]
    ];
    
    console.log('Hyperbar chords:', this.currentHyperbarChords.map(c => c.toString()));
    
    // Reset bar index
    this.currentBarIndex = -1;  // Will be set to 0 on first note
  }

  /**
   * Update rhythm onsets for the current bar (used by Hawkes process)
   */
  private updateBarRhythmOnsets(barIndex: number, barStartTime: number): void {
    if (barIndex >= 0 && barIndex < this.currentHyperbarRhythms.length) {
      const rhythmHex = this.currentHyperbarRhythms[barIndex];
      const onsets = parseRhythmHex(rhythmHex);
      this.currentRhythmOnsets = onsets.map(onset => barStartTime + onset * this.sixteenthSeconds);
    }
  }

  private refreshPitchClasses(barIndex: number): void {
    if (barIndex >= 0 && barIndex < this.currentHyperbarChords.length) {
      const chord = this.currentHyperbarChords[barIndex];
      this.activePitchClasses = chord.asSequence();
      
      if (this.onChordChange) {
        this.onChordChange(chord.toString());
      }
    }
  }

  /**
   * Calculate the current Hawkes process intensity.
   * Combines base rate with excitation from recent events and rhythm proximity.
   * All Hawkes parameters are bar-relative and scale with BPM.
   */
  private calculateHawkesIntensity(currentTime: number): number {
    // Convert bar-relative parameters to time-relative
    const barsPerSecond = this.bpm / 60 / BEATS_PER_BAR;
    const baseRatePerSecond = this.hawkesBaseRate * barsPerSecond;
    const decayPerSecond = this.hawkesDecay * barsPerSecond;
    
    // Clean up old events (older than 1 bar)
    const cutoffTime = currentTime - (1 / barsPerSecond);
    this.hawkesEventTimes = this.hawkesEventTimes.filter(t => t > cutoffTime);
    
    // Calculate excitation from recent events
    let excitation = 0;
    for (const eventTime of this.hawkesEventTimes) {
      const timeSinceEvent = currentTime - eventTime;
      excitation += this.hawkesExcitation * barsPerSecond * Math.exp(-decayPerSecond * timeSinceEvent);
    }
    
    // Calculate rhythm proximity boost (also scales with tempo)
    // Increase intensity when approaching rhythm onsets from the pattern (only future onsets)
    let rhythmBoost = 0;
    const beatsPerSecond = this.bpm / 60;
    for (const onsetTime of this.currentRhythmOnsets) {
      const distanceToOnset = onsetTime - currentTime;  // Positive = onset is in future
      // Only boost for upcoming onsets (within 1/8 note ahead)
      if (distanceToOnset > 0 && distanceToOnset < this.sixteenthSeconds * 2) {
        rhythmBoost += 3.0 * beatsPerSecond * Math.exp(-distanceToOnset / (this.sixteenthSeconds * 0.5));
      }
    }
    
    return baseRatePerSecond + excitation + rhythmBoost;
  }

  /**
   * Sample the next event time from the Hawkes process using thinning algorithm.
   */
  private sampleNextHawkesEventTime(currentTime: number): number {
    // Use thinning (Ogata's algorithm) to sample from non-homogeneous Poisson process
    const barsPerSecond = this.bpm / 60 / BEATS_PER_BAR;
    let t = currentTime;
    // Upper bound on intensity (converted to per-second)
    const maxIntensity = (this.hawkesBaseRate + this.hawkesExcitation * this.hawkesEventTimes.length + 24.0) * barsPerSecond;
    
    while (true) {
      // Sample from homogeneous Poisson with rate = maxIntensity
      const u1 = Math.random();
      const interarrival = -Math.log(u1) / maxIntensity;
      t += interarrival;
      
      // Accept/reject based on actual intensity
      const actualIntensity = this.calculateHawkesIntensity(t);
      const u2 = Math.random();
      
      if (u2 <= actualIntensity / maxIntensity) {
        return t;  // Accept this event time
      }
      // Otherwise reject and continue sampling
      
      // Safety: don't look more than 1 bar ahead
      if (t > currentTime + (1 / barsPerSecond)) {
        return currentTime + (0.5 / barsPerSecond) + Math.random() * (0.5 / barsPerSecond);
      }
    }
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

  /**
   * Trigger a note from the Hawkes process
   */
  private triggerHawkesNote(whenTime: number): void {
    // Determine current bar from time
    const timeInHyperbar = whenTime - this.hyperbarStartTime;
    const barIndex = Math.floor(timeInHyperbar / this.barSeconds);
    
    // Update chord if bar changed
    if (barIndex !== this.currentBarIndex && barIndex >= 0 && barIndex < BARS_PER_HYPERBAR) {
      this.currentBarIndex = barIndex;
      this.refreshPitchClasses(barIndex);
      // Update rhythm onsets for the new bar
      const barStartTime = this.hyperbarStartTime + barIndex * this.barSeconds;
      this.updateBarRhythmOnsets(barIndex, barStartTime);
    }
    
    if (this.activePitchClasses.length === 0) {
      return;
    }

    // Record event time for Hawkes excitation
    this.hawkesEventTimes.push(whenTime);
    
    // Pick a random pitch from the current chord
    const pitchClass = this.activePitchClasses[
      Math.floor(Math.random() * this.activePitchClasses.length)
    ];
    
    // Smooth octave evolution: change by at most 1
    const octaveChange = Math.floor(Math.random() * 3) - 1;  // -1, 0, or 1
    this.currentOctave = Math.max(
      OCTAVE_MIN, 
      Math.min(OCTAVE_MAX, this.currentOctave + octaveChange)
    );
    
    const octave = this.currentOctave;
    const midi = octave * 12 + pitchClass;
    const frequency = midiToFreq(midi);
    const maxDurationSeconds = musicalDurationToSeconds(this.synthParams.maxNoteDuration, this.bpm);
    const duration = maxDurationSeconds * (0.3 + Math.random() * 0.7);

    console.log('Hawkes note:', { pitchClass, octave, frequency: frequency.toFixed(1), whenTime: whenTime.toFixed(2), intensity: this.calculateHawkesIntensity(whenTime).toFixed(2) });
    
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
      // Initialize first bar's rhythm onsets
      this.updateBarRhythmOnsets(0, newHyperbarStart);
      this.currentBarIndex = -1;  // Will be updated on first note
      console.log('New hyperbar:', this.currentHyperbarRhythms);
    }

    // Update bar rhythm onsets if we've moved to a new bar
    const timeInHyperbar = currentTime - this.hyperbarStartTime;
    const currentBarIdx = Math.floor(timeInHyperbar / this.barSeconds);
    if (currentBarIdx !== this.currentBarIndex && currentBarIdx >= 0 && currentBarIdx < BARS_PER_HYPERBAR) {
      const barStartTime = this.hyperbarStartTime + currentBarIdx * this.barSeconds;
      this.updateBarRhythmOnsets(currentBarIdx, barStartTime);
    }

    // Schedule Hawkes process notes
    while (this.nextHawkesCheckTime <= currentTime + lookAhead) {
      // Sample next event time from Hawkes process
      const nextEventTime = this.sampleNextHawkesEventTime(this.nextHawkesCheckTime);
      
      if (nextEventTime <= currentTime + lookAhead) {
        const noteTime = Math.max(nextEventTime, currentTime + 0.02);
        this.triggerHawkesNote(noteTime);
        this.nextHawkesCheckTime = nextEventTime + 0.01;  // Small gap to avoid duplicate triggers
      } else {
        // Next event is beyond lookahead, update check time and break
        this.nextHawkesCheckTime = nextEventTime;
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
      
      // Reset octave to middle of range
      this.currentOctave = Math.floor((OCTAVE_MIN + OCTAVE_MAX) / 2);
      
      // Reset Hawkes process state
      this.hawkesEventTimes = [];
      this.nextHawkesCheckTime = startTime;
      this.currentRhythmOnsets = [];
      
      // Reset bar index
      this.currentBarIndex = -1;
      
      // Generate first hyperbar
      this.generateHyperbar();
      
      // Initialize rhythm onsets for first bar
      this.updateBarRhythmOnsets(0, startTime);
      
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
      
      console.log('Starting Hawkes process scheduler');
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

  /**
   * Interface for a scheduled note event (for offline rendering using Hawkes process)
   */
  private generateNoteEvents(numHyperbars: number): { time: number; frequency: number; duration: number; midi: number; velocity: number }[] {
    const events: { time: number; frequency: number; duration: number; midi: number; velocity: number }[] = [];
    
    // Save current state
    const savedScaleRotation = this.currentScaleRotation;
    const savedScale = [...this.currentScale];
    const savedKey = this.currentKey;
    const savedBarIndex = this.currentBarIndex;
    const savedOctave = this.currentOctave;
    const savedRhythmOnsets = [...this.currentRhythmOnsets];
    
    // Reset state for rendering
    this.currentScaleRotation = Math.floor(Math.random() * 12);
    this.currentScale = getBebopScale(this.currentScaleRotation);
    this.currentKey = getKeyFromRotation(this.currentScaleRotation);
    this.currentBarIndex = -1;
    this.currentOctave = Math.floor((OCTAVE_MIN + OCTAVE_MAX) / 2);
    
    // For offline rendering, use a simpler approach:
    // Sample notes at rhythm onsets with some randomization, plus additional random notes
    // This avoids the Hawkes feedback loop issue while maintaining musical character
    const avgNotesPerBeat = this.hawkesBaseRate;
    
    for (let hyperbar = 0; hyperbar < numHyperbars; hyperbar++) {
      const hyperbarStart = hyperbar * this.hyperbarSeconds;
      
      // Generate hyperbar data
      this.generateHyperbar();
      
      // Process each bar
      for (let barIndex = 0; barIndex < BARS_PER_HYPERBAR; barIndex++) {
        const barStartTime = hyperbarStart + barIndex * this.barSeconds;
        
        // Update chord for this bar
        if (barIndex >= 0 && barIndex < this.currentHyperbarChords.length) {
          this.currentBarIndex = barIndex;
          const chord = this.currentHyperbarChords[barIndex];
          this.activePitchClasses = chord.asSequence();
          
          // Get rhythm onsets for this bar
          const rhythmHex = this.currentHyperbarRhythms[barIndex];
          const onsets = parseRhythmHex(rhythmHex);
          this.currentRhythmOnsets = onsets.map(onset => barStartTime + onset * this.sixteenthSeconds);
        }
        
        if (this.activePitchClasses.length === 0) continue;
        
        // Generate notes near rhythm onsets (with probability based on excitation)
        for (const onsetTime of this.currentRhythmOnsets) {
          // Higher base rate = higher probability of playing on rhythm
          const playProbability = Math.min(0.9, avgNotesPerBeat * 0.3);
          if (Math.random() < playProbability) {
            // Add slight timing variation
            const timeOffset = (Math.random() - 0.5) * this.sixteenthSeconds * 0.2;
            const noteTime = onsetTime + timeOffset;
            
            this.addNoteEvent(events, noteTime);
            
            // Excitation: chance of additional clustered notes
            let clusterCount = 0;
            let clusterTime = noteTime;
            while (Math.random() < this.hawkesExcitation * 0.3 && clusterCount < 3) {
              clusterTime += this.sixteenthSeconds * (0.1 + Math.random() * 0.3);
              this.addNoteEvent(events, clusterTime);
              clusterCount++;
            }
          }
        }
        
        // Add some random notes between rhythm onsets based on base rate
        const barBeats = 4;
        const expectedExtraNotes = avgNotesPerBeat * barBeats * 0.3;  // 30% additional random notes
        const extraNotes = Math.floor(expectedExtraNotes + (Math.random() < (expectedExtraNotes % 1) ? 1 : 0));
        
        for (let i = 0; i < extraNotes; i++) {
          const randomTime = barStartTime + Math.random() * this.barSeconds;
          this.addNoteEvent(events, randomTime);
        }
      }
    }
    
    // Restore state
    this.currentScaleRotation = savedScaleRotation;
    this.currentScale = savedScale;
    this.currentKey = savedKey;
    this.currentBarIndex = savedBarIndex;
    this.currentOctave = savedOctave;
    this.currentRhythmOnsets = savedRhythmOnsets;
    
    return events.sort((a, b) => a.time - b.time);
  }

  /**
   * Helper to add a note event during offline rendering
   */
  private addNoteEvent(events: { time: number; frequency: number; duration: number; midi: number; velocity: number }[], noteTime: number): void {
    if (this.activePitchClasses.length === 0) return;
    
    const pitchClass = this.activePitchClasses[
      Math.floor(Math.random() * this.activePitchClasses.length)
    ];
    
    // Smooth octave evolution
    const octaveChange = Math.floor(Math.random() * 3) - 1;
    this.currentOctave = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, this.currentOctave + octaveChange));
    
    const midi = this.currentOctave * 12 + pitchClass;
    const frequency = midiToFreq(midi);
    const maxDurationSeconds = musicalDurationToSeconds(this.synthParams.maxNoteDuration, this.bpm);
    const duration = maxDurationSeconds * (0.3 + Math.random() * 0.7);
    
    events.push({ time: noteTime, frequency, duration, midi, velocity: 70 });
  }

  /**
   * Render to WAV file (offline rendering)
   */
  async renderWav(numHyperbars: number): Promise<Blob> {
    const events = this.generateNoteEvents(numHyperbars);
    const totalDuration = numHyperbars * this.hyperbarSeconds + 5; // Extra 5 seconds for delay/reverb tail
    const sampleRate = 44100;
    
    // Create offline audio context
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);
    
    // Create master gain (notes connect here)
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.5;
    
    // Build the effects chain: masterGain -> delay -> reverb -> destination
    let currentOutput: AudioNode = masterGain;
    
    // Add delay effect if enabled
    const { enabled: delayEnabled, duration: delayDuration, feedback, mix, filterType, filterFrequency, filterResonance, filterOrder } = this.synthParams.delay;
    if (delayEnabled && mix > 0) {
      const delaySeconds = musicalDurationToSeconds(delayDuration, this.bpm);
      
      const delayNode = offlineCtx.createDelay(5.0);
      delayNode.delayTime.value = delaySeconds;
      
      const delayFeedbackGain = offlineCtx.createGain();
      delayFeedbackGain.gain.value = Math.min(feedback, 0.95);
      
      const delayDryGain = offlineCtx.createGain();
      delayDryGain.gain.value = 1 - mix;
      
      const delayWetGain = offlineCtx.createGain();
      delayWetGain.gain.value = mix;
      
      const delayMixNode = offlineCtx.createGain();
      delayMixNode.gain.value = 1.0;
      
      const delayInputGain = offlineCtx.createGain();
      delayInputGain.gain.value = 1.0;
      
      // Create filter chain for delay feedback
      const numFilters = filterOrder / 6;
      const delayFilters: BiquadFilterNode[] = [];
      for (let i = 0; i < numFilters; i++) {
        const filter = offlineCtx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFrequency;
        filter.Q.value = filterResonance;
        delayFilters.push(filter);
      }
      
      // Connect delay chain with filters
      currentOutput.connect(delayDryGain);
      currentOutput.connect(delayInputGain);
      delayInputGain.connect(delayNode);
      
      if (delayFilters.length > 0) {
        delayNode.connect(delayFilters[0]);
        for (let i = 0; i < delayFilters.length - 1; i++) {
          delayFilters[i].connect(delayFilters[i + 1]);
        }
        const lastFilter = delayFilters[delayFilters.length - 1];
        lastFilter.connect(delayFeedbackGain);
        lastFilter.connect(delayWetGain);
      } else {
        delayNode.connect(delayFeedbackGain);
        delayNode.connect(delayWetGain);
      }
      
      delayFeedbackGain.connect(delayInputGain);
      delayDryGain.connect(delayMixNode);
      delayWetGain.connect(delayMixNode);
      
      currentOutput = delayMixNode;
    }
    
    // Add reverb
    const reverbNode = this.createOfflineReverb(offlineCtx);
    if (reverbNode) {
      const reverbDryGain = offlineCtx.createGain();
      const reverbWetGain = offlineCtx.createGain();
      reverbDryGain.gain.value = 0.7;
      reverbWetGain.gain.value = 0.3;
      
      currentOutput.connect(reverbDryGain);
      currentOutput.connect(reverbNode);
      reverbNode.connect(reverbWetGain);
      
      reverbDryGain.connect(offlineCtx.destination);
      reverbWetGain.connect(offlineCtx.destination);
    } else {
      // No reverb, connect directly to destination
      currentOutput.connect(offlineCtx.destination);
    }
    
    const { attack, decay, sustain, release } = this.synthParams.envelope;
    const { rate: vibratoRate, depth: vibratoDepth } = this.synthParams.vibrato;
    const { rate: tremoloRate, depth: tremoloDepth } = this.synthParams.tremolo;
    
    // Schedule all notes
    for (const event of events) {
      const oscillator = offlineCtx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(event.frequency, event.time);
      
      // Create vibrato (frequency modulation) using LFO
      const vibratoLFO = offlineCtx.createOscillator();
      const vibratoGain = offlineCtx.createGain();
      vibratoLFO.type = 'sine';
      vibratoLFO.frequency.setValueAtTime(vibratoRate, event.time);
      // Vibrato depth is in semitones, convert to frequency deviation
      vibratoGain.gain.setValueAtTime(event.frequency * vibratoDepth, event.time);
      vibratoLFO.connect(vibratoGain);
      vibratoGain.connect(oscillator.frequency);
      
      // Create tremolo (amplitude modulation) using LFO
      const tremoloLFO = offlineCtx.createOscillator();
      const tremoloGain = offlineCtx.createGain();
      const tremoloDepthNode = offlineCtx.createGain();
      tremoloLFO.type = 'sine';
      tremoloLFO.frequency.setValueAtTime(tremoloRate, event.time);
      // Tremolo oscillates between (1 - depth) and 1
      tremoloGain.gain.setValueAtTime(1 - tremoloDepth / 2, event.time);
      tremoloDepthNode.gain.setValueAtTime(tremoloDepth / 2, event.time);
      tremoloLFO.connect(tremoloDepthNode);
      
      const envelopeGain = offlineCtx.createGain();
      envelopeGain.gain.setValueAtTime(0, event.time);
      
      const peakTime = event.time + attack;
      const decayEndTime = peakTime + decay;
      const releaseStartTime = event.time + event.duration;
      const releaseEndTime = releaseStartTime + release;
      
      // Use same gain level as live playback (0.3), scaled by velocity
      const gain = 0.3 * (event.velocity / 127);
      envelopeGain.gain.linearRampToValueAtTime(gain, peakTime);
      envelopeGain.gain.linearRampToValueAtTime(gain * sustain, decayEndTime);
      envelopeGain.gain.setValueAtTime(gain * sustain, releaseStartTime);
      envelopeGain.gain.linearRampToValueAtTime(0, releaseEndTime);
      
      // Connect chain: oscillator -> envelope -> tremolo mix -> master
      oscillator.connect(envelopeGain);
      envelopeGain.connect(tremoloGain);
      tremoloDepthNode.connect(tremoloGain.gain);
      tremoloGain.connect(masterGain);
      
      // Start all oscillators
      oscillator.start(event.time);
      vibratoLFO.start(event.time);
      tremoloLFO.start(event.time);
      
      // Stop all oscillators
      oscillator.stop(releaseEndTime + 0.1);
      vibratoLFO.stop(releaseEndTime + 0.1);
      tremoloLFO.stop(releaseEndTime + 0.1);
    }
    
    // Render
    const audioBuffer = await offlineCtx.startRendering();
    
    // Convert to WAV
    return this.audioBufferToWav(audioBuffer);
  }

  private createOfflineReverb(ctx: OfflineAudioContext): ConvolverNode | null {
    try {
      const convolver = ctx.createConvolver();
      const rate = ctx.sampleRate;
      const length = rate * 2;
      const impulse = ctx.createBuffer(2, length, rate);
      const decay = 1.5;
      
      for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const t = i / rate;
          const envelope = Math.exp(-t / decay);
          channelData[i] = (Math.random() * 2 - 1) * envelope * 0.3;
        }
      }
      
      convolver.buffer = impulse;
      return convolver;
    } catch (e) {
      return null;
    }
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Interleave channels and write samples
    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }
    
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Render to MIDI file
   */
  renderMidi(numHyperbars: number): Blob {
    const events = this.generateNoteEvents(numHyperbars);
    const ticksPerBeat = 480;
    const microsecondsPerBeat = Math.round(60000000 / this.bpm);
    
    // Convert time to ticks
    const tickEvents: { tick: number; midi: number; duration: number; velocity: number }[] = events.map(e => ({
      tick: Math.round(e.time * (this.bpm / 60) * ticksPerBeat),
      midi: e.midi,
      duration: Math.round(e.duration * (this.bpm / 60) * ticksPerBeat),
      velocity: e.velocity
    }));
    
    // Build MIDI file
    const midiData: number[] = [];
    
    // Helper to write variable-length quantity
    const writeVLQ = (value: number): number[] => {
      const bytes: number[] = [];
      bytes.unshift(value & 0x7F);
      value >>= 7;
      while (value > 0) {
        bytes.unshift((value & 0x7F) | 0x80);
        value >>= 7;
      }
      return bytes;
    };
    
    // Header chunk
    midiData.push(0x4D, 0x54, 0x68, 0x64); // MThd
    midiData.push(0, 0, 0, 6); // chunk length
    midiData.push(0, 0); // format 0
    midiData.push(0, 1); // 1 track
    midiData.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF);
    
    // Track chunk
    const trackData: number[] = [];
    
    // Tempo meta event
    trackData.push(0); // delta time
    trackData.push(0xFF, 0x51, 0x03); // tempo meta event
    trackData.push((microsecondsPerBeat >> 16) & 0xFF);
    trackData.push((microsecondsPerBeat >> 8) & 0xFF);
    trackData.push(microsecondsPerBeat & 0xFF);
    
    // Sort events and create note on/off pairs
    const noteEvents: { tick: number; type: 'on' | 'off'; midi: number; velocity: number }[] = [];
    for (const e of tickEvents) {
      noteEvents.push({ tick: e.tick, type: 'on', midi: e.midi, velocity: e.velocity });
      noteEvents.push({ tick: e.tick + e.duration, type: 'off', midi: e.midi, velocity: 0 });
    }
    noteEvents.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
    
    // Write note events
    let lastTick = 0;
    for (const e of noteEvents) {
      const delta = e.tick - lastTick;
      trackData.push(...writeVLQ(delta));
      
      if (e.type === 'on') {
        trackData.push(0x90, e.midi, e.velocity); // Note on, channel 0
      } else {
        trackData.push(0x80, e.midi, 0); // Note off, channel 0
      }
      
      lastTick = e.tick;
    }
    
    // End of track
    trackData.push(0, 0xFF, 0x2F, 0x00);
    
    // Track header
    midiData.push(0x4D, 0x54, 0x72, 0x6B); // MTrk
    const trackLength = trackData.length;
    midiData.push((trackLength >> 24) & 0xFF);
    midiData.push((trackLength >> 16) & 0xFF);
    midiData.push((trackLength >> 8) & 0xFF);
    midiData.push(trackLength & 0xFF);
    midiData.push(...trackData);
    
    return new Blob([new Uint8Array(midiData)], { type: 'audio/midi' });
  }
}
