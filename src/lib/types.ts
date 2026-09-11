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
	/** facesjs face object — the deterministic "seed" for this speaker's avatar */
	face: FaceConfig;
}

export interface AudioEffect {
	name: string;
	on: boolean;
	value: string;
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
