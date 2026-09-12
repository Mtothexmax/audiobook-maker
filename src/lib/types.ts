import type { FaceConfig } from 'facesjs';

export interface VoicePreset {
	id: string;
	name: string;
	language: string;
	flag: string;
	voiceId: string;
	gender?: 'male' | 'female';
}

export interface Character {
	id: string;
	name: string;
	voiceId: string;
	language?: string;
	voicePreset?: string;
	color: string;
	emotion: string;
	/**
	 * Optional facesjs avatar ("icon"). Absent by default and omitted from the
	 * export JSON when unset — saves significant token space. Generate one via
	 * rerollFace, remove it via removeFace.
	 */
	face?: FaceConfig;
}

export interface EffectParam {
	name: string;
	/** current value in real units (e.g. ms, %, dB) */
	value: number;
	min: number;
	max: number;
	step: number;
	/** unit suffix shown after the value (e.g. '%', ' ms', ' dB', ' st') */
	unit: string;
}

export interface AudioEffect {
	/** unique per clip (several instances of one type may coexist) */
	id: string;
	/** effect type name, e.g. 'Echo' — see EFFECT_TYPES */
	name: string;
	on: boolean;
	params: EffectParam[];
}

export interface BaseClip {
	id: string;
	/** seconds from timeline start */
	start: number;
	fadeIn: number;
	fadeOut: number;
	rendered: boolean;
	/** true while a Fish Audio render is simulated */
	rendering: boolean;
}

export interface DialogueClip extends BaseClip {
	type: 'dialogue';
	characterId: string;
	text: string;
	/** null while unrendered → estimated from text length */
	duration: number | null;
	/** empty while unrendered */
	waveform: number[];
	effects: AudioEffect[];
	/** last synthesis error, if a render failed */
	renderError?: string | null;
}

export interface SoundClip extends BaseClip {
	type: 'sound';
	name: string;
	icon: string;
	duration: number;
	waveform: number[];
	file?: string;
	/** per-clip FX toggles (engine application for non-dialogue clips: not yet implemented) */
	effects: AudioEffect[];
}

export interface AmbienceLayer {
	id: string;
	name: string;
	icon: string;
	file: string;
	/** Volume fraction 0.0 .. 1.0 */
	volume: number;
	enabled: boolean;
}

export interface AmbienceClip extends BaseClip {
	type: 'ambience';
	name: string;
	icon: string;
	duration: number;
	waveform: number[];
	layers: AmbienceLayer[];
	/** per-clip FX toggles (engine application for ambience: not yet implemented) */
	effects: AudioEffect[];
}

export type Clip = DialogueClip | SoundClip | AmbienceClip;

export interface Track {
	id: string;
	name: string;
	/** mutes every clip on this lane */
	muted: boolean;
	clips: Clip[];
}

export interface Project {
	name: string;
	characters: Character[];
	tracks: Track[];
}
