// runes ($state) are compiler-injected in .svelte.ts files — no import needed
import { generate } from 'facesjs';
import type { FaceConfig } from 'facesjs';
import type {
	AmbienceClip,
	AudioEffect,
	Character,
	Clip,
	DialogueClip,
	EffectParam,
	Project,
	SoundClip,
	Track,
	VoicePreset
} from './types';
import audioCatalog from './audio-catalog.json';
import { estimateDuration, toFishText } from './tags';
import { genWaveform } from './waveform';
import {
	computePeaks,
	elapsed,
	getBuffer,
	hasAudio,
	setBuffer,
	clearBuffer,
	loadAudioBuffer,
	renderAmbienceMixdown,
	cacheRenderedAudio,
	loadCachedRender,
	deleteCachedRender,
	measureLoudnessDb,
	decodeAudioBytes,
	saveUploadedAudio,
	loadUploadedAudio,
	startPlayback,
	stopPlayback,
	resumeContext,
	synthesize,
	type ScheduledClip
} from './audio';

/* ------------------------------------------------------------------ */
/* Voice library presets with flags and languages                     */
/* ------------------------------------------------------------------ */

export const VOICE_PRESETS: VoicePreset[] = [
	// English (Default)
	{ id: 'en-mara', name: 'Mara (Storyteller)', language: 'English', flag: '🇬🇧', voiceId: 'fish-voice-mara-01', gender: 'female' },
	{ id: 'en-elias', name: 'Elias (Narrator / Action)', language: 'English', flag: '🇬🇧', voiceId: 'fish-voice-elias-07', gender: 'male' },
	{ id: 'en-narrator', name: 'Classic Narrator', language: 'English', flag: '🇺🇸', voiceId: 'fish-voice-narrator-01' },
	{ id: 'en-oliver', name: 'Oliver (Warm / Audiobooks)', language: 'English', flag: '🇬🇧', voiceId: 'fish-voice-oliver-03', gender: 'male' },
	{ id: 'en-sophia', name: 'Sophia (Expressive)', language: 'English', flag: '🇺🇸', voiceId: 'fish-voice-sophia-02', gender: 'female' },

	// German
	{ id: 'de-felix', name: 'Felix (Hörbuch Erzähler)', language: 'Deutsch', flag: '🇩🇪', voiceId: 'fish-voice-felix-de', gender: 'male' },
	{ id: 'de-hannah', name: 'Hannah (Klar & Ruhig)', language: 'Deutsch', flag: '🇩🇪', voiceId: 'fish-voice-hannah-de', gender: 'female' },
	{ id: 'de-max', name: 'Maximilian (Tief & Ausdrucksstark)', language: 'Deutsch', flag: '🇩🇪', voiceId: 'fish-voice-max-de', gender: 'male' },
	{ id: 'de-leonie', name: 'Leonie (Dynamisch)', language: 'Deutsch', flag: '🇩🇪', voiceId: 'fish-voice-leonie-de', gender: 'female' },

	// French
	{ id: 'fr-julien', name: 'Julien (Narrateur)', language: 'Français', flag: '🇫🇷', voiceId: 'fish-voice-julien-fr', gender: 'male' },
	{ id: 'fr-camille', name: 'Camille (Douce)', language: 'Français', flag: '🇫🇷', voiceId: 'fish-voice-camille-fr', gender: 'female' },

	// Spanish
	{ id: 'es-mateo', name: 'Mateo (Cálido)', language: 'Español', flag: '🇪🇸', voiceId: 'fish-voice-mateo-es', gender: 'male' },
	{ id: 'es-lucia', name: 'Lucía (Narradora)', language: 'Español', flag: '🇪🇸', voiceId: 'fish-voice-lucia-es', gender: 'female' },

	// Italian
	{ id: 'it-marco', name: 'Marco (Narratore)', language: 'Italiano', flag: '🇮🇹', voiceId: 'fish-voice-marco-it', gender: 'male' },
	{ id: 'it-giulia', name: 'Giulia (Espressiva)', language: 'Italiano', flag: '🇮🇹', voiceId: 'fish-voice-giulia-it', gender: 'female' },

	// Japanese
	{ id: 'ja-kenji', name: 'Kenji (ケンジ)', language: '日本語', flag: '🇯🇵', voiceId: 'fish-voice-kenji-ja', gender: 'male' },
	{ id: 'ja-sakura', name: 'Sakura (サクラ)', language: '日本語', flag: '🇯🇵', voiceId: 'fish-voice-sakura-ja', gender: 'female' }
];

/* ------------------------------------------------------------------ */
/* Sound library — 3 Categories: Ambience, Music, Sounds               */
/* ------------------------------------------------------------------ */

export type SoundCategory = 'ambience' | 'music' | 'sounds';

export interface SoundCategoryInfo {
	id: SoundCategory;
	name: string;
	icon: string;
	description: string;
	defaultDuration: number;
}

export const SOUND_CATEGORIES: SoundCategoryInfo[] = [
	{
		id: 'ambience',
		name: 'Ambience',
		icon: 'filter_drama',
		description: 'Mixable multi-loop ambient textures & atmospheres',
		defaultDuration: 30
	},
	{
		id: 'music',
		name: 'Music',
		icon: 'music_note',
		description: 'Background soundtrack beds & music cues',
		defaultDuration: 15
	},
	{
		id: 'sounds',
		name: 'Sounds',
		icon: 'volume_up',
		description: 'Sound effects & one-shots',
		defaultDuration: 2.5
	}
];

export const AUDIO_CATALOG = audioCatalog;

export interface SoundPreset {
	name: string;
	icon: string;
	duration: number;
}

export const SOUND_PRESETS: SoundPreset[] = [
	{ name: 'Rain Ambience', icon: 'rainy', duration: 6 },
	{ name: 'Wind Gust', icon: 'air', duration: 3 },
	{ name: 'Door Creak', icon: 'sensor_door', duration: 1.4 },
	{ name: 'Footsteps', icon: 'directions_walk', duration: 2.2 },
	{ name: 'Thunder Clap', icon: 'thunderstorm', duration: 1.2 },
	{ name: 'Music Bed', icon: 'music_note', duration: 10 },
	{ name: 'Birdsong', icon: 'park', duration: 4 },
	{ name: 'Crowd Murmur', icon: 'groups', duration: 5 }
];

/* ------------------------------------------------------------------ */
/* Effect types — FL-style rack: each type owns tunable knob parameters */
/* ------------------------------------------------------------------ */

export interface EffectTypeDef {
	name: string;
	icon: string;
	defaultOn: boolean;
	makeParams: () => EffectParam[];
}

function P(name: string, value: number, min: number, max: number, step: number, unit: string): EffectParam {
	return { name, value, min, max, step, unit };
}

export const EFFECT_TYPES: EffectTypeDef[] = [
	{
		name: 'Echo',
		icon: 'repeat',
		defaultOn: true,
		makeParams: () => [
			P('Time', 180, 0, 1000, 1, ' ms'),
			P('Feedback', 35, 0, 95, 1, '%'),
			P('Mix', 18, 0, 100, 1, '%'),
			P('Pan', 0, -100, 100, 1, '%')
		]
	},
	{
		name: 'Delay',
		icon: 'timer',
		defaultOn: false,
		makeParams: () => [
			P('Time', 240, 0, 2000, 1, ' ms'),
			P('Feedback', 30, 0, 95, 1, '%'),
			P('Mix', 25, 0, 100, 1, '%'),
			P('Pan', 0, -100, 100, 1, '%')
		]
	},
	{
		name: 'Pitch',
		icon: 'height',
		defaultOn: false,
		makeParams: () => [
			P('Shift', 0, -12, 12, 0.5, ' st'),
			P('Mix', 100, 0, 100, 1, '%'),
			P('Pan', 0, -100, 100, 1, '%')
		]
	},
	{
		name: 'Reverb',
		icon: 'waves',
		defaultOn: true,
		makeParams: () => [
			P('Room', 40, 0, 100, 1, '%'),
			P('Decay', 1.2, 0, 10, 0.1, ' s'),
			P('Mix', 12, 0, 100, 1, '%'),
			P('Pan', 0, -100, 100, 1, '%')
		]
	},
	{
		name: 'Compressor',
		icon: 'compress',
		defaultOn: false,
		makeParams: () => [
			P('Threshold', -18, -60, 0, 1, ' dB'),
			P('Ratio', 4, 1, 20, 0.5, ':1'),
			P('Gain', 3, 0, 24, 0.5, ' dB'),
			P('Pan', 0, -100, 100, 1, '%')
		]
	},
	{
		name: 'Loudness',
		icon: 'equalizer',
		defaultOn: false,
		makeParams: () => [P('Gain', 0, -24, 24, 0.5, ' dB'), P('Pan', 0, -100, 100, 1, '%')]
	}
];

/** Fresh default rack for a new clip (same defaults as the legacy presets). */
export function defaultEffects(): AudioEffect[] {
	return EFFECT_TYPES.map((t) => ({
		id: nextId('fx'),
		name: t.name,
		on: t.defaultOn,
		params: t.makeParams()
	}));
}

/** Default params for an effect type; unknown names get a generic Amount knob. */
export function makeEffectParams(name: string): EffectParam[] {
	const def = EFFECT_TYPES.find((t) => t.name === name);
	if (def) return def.makeParams();
	return [P('Amount', 50, 0, 100, 1, '%')];
}

const PALETTE = [
	'#8b5cf6',
	'#0891b2',
	'#64748b',
	'#ec4899',
	'#f59e0b',
	'#10b981',
	'#ef4444',
	'#3b82f6'
];

/* ------------------------------------------------------------------ */
/* ids                                                                */
/* ------------------------------------------------------------------ */

let idCounter = 100;
export function nextId(prefix: string): string {
	idCounter++;
	return `${prefix}-${idCounter}`;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function makeCharacter(
	name: string,
	voiceId: string,
	emotion: string,
	color: string,
	gender?: 'male' | 'female',
	language = 'English',
	voicePreset?: string
): Character {
	return {
		id: nextId('char'),
		name,
		voiceId,
		language,
		voicePreset,
		color,
		emotion,
		// No avatar by default — the user adds one explicitly (saves JSON space).
		face: undefined
	};
}

function makeDialogue(
	id: string,
	characterId: string,
	text: string,
	start: number,
	opts: Partial<Pick<DialogueClip, 'rendered' | 'duration' | 'fadeIn' | 'fadeOut'>> = {}
): DialogueClip {
	const rendered = opts.rendered ?? false;
	return {
		id,
		type: 'dialogue',
		characterId,
		text,
		start,
		fadeIn: opts.fadeIn ?? 0,
		fadeOut: opts.fadeOut ?? 0,
		rendered,
		rendering: false,
		duration: rendered ? (opts.duration ?? estimateDuration(text)) : null,
		waveform: rendered ? genWaveform(id, 64) : [],
		renderError: null,
		effects: defaultEffects()
	};
}

function makeSound(
	id: string,
	name: string,
	icon: string,
	duration: number,
	start: number,
	opts: Partial<Pick<SoundClip, 'fadeIn' | 'fadeOut'>> = {}
): SoundClip {
	return {
		id,
		type: 'sound',
		name,
		icon,
		duration,
		start,
		fadeIn: opts.fadeIn ?? 0,
		fadeOut: opts.fadeOut ?? 0,
		rendered: true,
		rendering: false,
		waveform: genWaveform(id, 64),
		effects: defaultEffects()
	};
}

export function makeAmbience(
	id: string,
	name: string,
	duration: number,
	start: number,
	opts: Partial<Pick<AmbienceClip, 'fadeIn' | 'fadeOut'>> = {}
): AmbienceClip {
	return {
		id,
		type: 'ambience',
		name,
		icon: 'filter_drama',
		duration,
		start,
		fadeIn: opts.fadeIn ?? 1.5,
		fadeOut: opts.fadeOut ?? 2.0,
		// No mixdown exists yet — user presses Regenerate to render the
		// visible-length mix from the enabled layers.
		rendered: false,
		rendering: false,
		waveform: [],
		layers: [],
		effects: defaultEffects()
	};
}

function initialProject(): Project {
	const mara = makeCharacter('Mara', 'fish-voice-mara-01', 'calm', PALETTE[0], 'female', 'English', 'en-mara');
	const elias = makeCharacter('Elias', 'fish-voice-elias-07', 'neutral', PALETTE[1], 'male', 'English', 'en-elias');
	const narrator = makeCharacter('Narrator', 'fish-voice-narrator-01', 'calm', PALETTE[2], undefined, 'English', 'en-narrator');

	const track1: Track = {
		id: nextId('track'),
		name: 'Narration & Dialogue',
		muted: false,
		clips: [
			makeDialogue('d1', narrator.id, 'The harbor lights flickered through the fog.', 0, {
				fadeIn: 0.4,
				fadeOut: 0.3
			}),
			makeDialogue(
				'd2',
				mara.id,
				'[emotion:whisper] Did you hear that? [pause:0.4] Something is moving out there.',
				12.2,
				{ rendered: false }
			),
			makeDialogue('d3', elias.id, '[emotion:angry] Stay behind me. [pause:0.3] Do not move.', 20.1, {
				fadeIn: 0.1,
				fadeOut: 0.2
			}),
			makeDialogue(
				'd4',
				narrator.id,
				'She held her breath [pause:0.5] and listened to the waves.',
				27.4,
				{ rendered: false }
			)
		]
	};

	const track2: Track = {
		id: nextId('track'),
		name: 'Music & Ambience',
		muted: false,
		clips: [
			makeAmbience('a1', 'Rainy Night Atmosphere', 28, 0, { fadeIn: 1.5, fadeOut: 2.5 }),
			makeDialogue('d5', mara.id, '[emotion:excited] Listen — the rain is letting up!', 13.5, {
				fadeIn: 0.2,
				fadeOut: 0.2
			}),
			makeSound('s2', 'Thunder Clap', 'thunderstorm', 1.3, 18.6, { fadeOut: 0.2 })
		]
	};

	const track3: Track = {
		id: nextId('track'),
		name: 'Atmosphere',
		muted: false,
		clips: [makeSound('s3', 'Crowd Murmur', 'groups', 5, 6.5)]
	};

	return {
		name: 'The Glass Harbor',
		characters: [mara, elias, narrator],
		tracks: [track1, track2, track3]
	};
}

/* ------------------------------------------------------------------ */
/* Persistence — project JSON in localStorage (rendered audio excluded)  */
/* Audio buffers live in audio.ts (memory + IndexedDB), never inside     */
/* `project`, so JSON.stringify(project) is audio-free by construction.  */
/* Waveform peak arrays are kept so the timeline still draws after reload*/
/* (clips simply need a re-render before playback).                      */
/* ------------------------------------------------------------------ */

const PROJECT_KEY = 'audioboook-maker:project';
const PROJECT_VERSION = 1;

function isValidProject(data: unknown): data is Project {
	if (!data || typeof data !== 'object') return false;
	const p = data as Record<string, unknown>;
	return (
		typeof p.name === 'string' &&
		Array.isArray(p.characters) &&
		Array.isArray(p.tracks) &&
		(p.tracks as unknown[]).every(
			(t) =>
				!!t &&
				typeof t === 'object' &&
				typeof (t as Track).id === 'string' &&
				Array.isArray((t as Track).clips)
		)
	);
}

/**
 * FX list for any clip type. Lazily backfills defaults onto clips stored
 * before effects existed (or hand-built ones), so badge + menu always work.
 */
export function clipEffects(clip: Clip): AudioEffect[] {
	const c = clip as Clip & { effects?: unknown };
	if (!Array.isArray(c.effects)) {
		c.effects = defaultEffects();
		return c.effects as AudioEffect[];
	}
	// Migrate legacy {name, on, value} entries and entries missing ids/params.
	let dirty = false;
	const migrated = (c.effects as unknown[]).map((raw) => {
		const r = (raw ?? {}) as { id?: unknown; name?: unknown; on?: unknown; params?: unknown };
		if (typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.params)) {
			return raw as AudioEffect;
		}
		dirty = true;
		const name = typeof r.name === 'string' && r.name ? r.name : 'Echo';
		return { id: nextId('fx'), name, on: !!r.on, params: makeEffectParams(name) };
	});
	if (dirty) c.effects = migrated;
	// Merge in params added to a type after the clip was stored (e.g. Pan),
	// keeping the user's tuned values untouched.
	const list = c.effects as AudioEffect[];
	for (const fx of list) {
		const def = EFFECT_TYPES.find((t) => t.name === fx.name);
		if (!def || !Array.isArray(fx.params)) continue;
		const have = new Set(fx.params.map((p) => p.name));
		for (const p of def.makeParams()) {
			if (!have.has(p.name)) {
				fx.params.push(p);
				have.add(p.name);
			}
		}
	}
	return list;
}

/** Backfill fields added after some projects were saved (effects, ambience layers/icon). */
function normalizeProject(p: Project) {
	for (const t of p.tracks) {
		for (const c of t.clips) {
			clipEffects(c);
			if (!Array.isArray(c.waveform)) c.waveform = [];
			if (c.type === 'ambience') {
				if (!Array.isArray(c.layers)) c.layers = [];
				if (typeof c.icon !== 'string' || !c.icon) c.icon = 'filter_drama';
			}
		}
	}
}

/** Bump the id counter past any restored ids (e.g. "clip-123") to avoid collisions. */
function syncIdCounter(p: Project) {
	let max = 100;
	const scan = (id: unknown) => {
		if (typeof id !== 'string') return;
		const m = /-(\d+)$/.exec(id);
		if (m) max = Math.max(max, parseInt(m[1], 10));
	};
	for (const c of p.characters) scan(c.id);
	for (const t of p.tracks) {
		scan(t.id);
		for (const clip of t.clips) scan(clip.id);
	}
	idCounter = max + 1;
}

function loadProject(): Project {
	if (typeof localStorage === 'undefined') return initialProject();
	try {
		const raw = localStorage.getItem(PROJECT_KEY);
		if (!raw) return initialProject();
		const parsed: unknown = JSON.parse(raw);
		// Accept our {version, project} envelope as well as a bare project.
		const envelope = parsed as { version?: unknown; project?: unknown };
		const data: unknown =
			envelope && typeof envelope === 'object' && 'project' in envelope
				? envelope.version !== undefined && envelope.version !== PROJECT_VERSION
					? null
					: envelope.project
				: parsed;
		if (!isValidProject(data)) return initialProject();
		normalizeProject(data);
		syncIdCounter(data);
		return data;
	} catch {
		return initialProject();
	}
}

export const project = $state<Project>(loadProject());

/** Write the project JSON to localStorage immediately. */
export function saveProjectNow(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(PROJECT_KEY, JSON.stringify({ version: PROJECT_VERSION, project }));
	} catch {
		/* quota exceeded or private browsing — ignore */
	}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced autosave — safe to call on every reactive change. */
export function persistProjectSoon(): void {
	if (typeof localStorage === 'undefined') return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		saveProjectNow();
	}, 500);
}

export const ui = $state({
	tab: 'timeline' as 'timeline' | 'characters' | 'export',
	/** px per second on the timeline */
	zoom: 70,
	playhead: 0,
	playing: false,
	selectedClipId: null as string | null,
	editingClipId: null as string | null,
	/** when set to the editing clip's id, the bottom drawer shows its FX menu */
	fxClipId: null as string | null,
	selectedCharacterId: null as string | null,
	settingsOpen: false
});

/* ------------------------------------------------------------------ */
/* Settings (Fish Audio API key) — persisted in localStorage           */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'audioboook-maker:settings';

export const FISH_MODELS = [
	{ id: 's2.1-pro-free', label: 'S2.1 Pro (free tier)' },
	{ id: 's2.1-pro', label: 'S2.1 Pro' },
	{ id: 's2-pro', label: 'S2 Pro' },
	{ id: 's1', label: 'S1 (legacy)' }
];

interface Settings {
	fishAudioApiKey: string;
	fishModel: string;
}

function loadSettings(): Settings {
	const fallback: Settings = { fishAudioApiKey: '', fishModel: 's2.1-pro-free' };
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw);
		return {
			fishAudioApiKey:
				typeof parsed.fishAudioApiKey === 'string' ? parsed.fishAudioApiKey : '',
			fishModel: typeof parsed.fishModel === 'string' ? parsed.fishModel : 's2.1-pro-free'
		};
	} catch {
		return fallback;
	}
}

export const settings = $state(loadSettings());

function persistSettings() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(
			SETTINGS_KEY,
			JSON.stringify({ fishAudioApiKey: settings.fishAudioApiKey, fishModel: settings.fishModel })
		);
	} catch {
		/* quota exceeded — ignore */
	}
}

export function setFishAudioApiKey(value: string) {
	settings.fishAudioApiKey = value;
	persistSettings();
}

export function clearFishAudioApiKey() {
	settings.fishAudioApiKey = '';
	persistSettings();
}

export function setFishModel(value: string) {
	settings.fishModel = value;
	persistSettings();
}

export const toasts = $state<{ id: number; text: string }[]>([]);
let toastId = 0;
export function toast(text: string) {
	const id = ++toastId;
	toasts.push({ id, text });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i >= 0) toasts.splice(i, 1);
	}, 2400);
}

/* ------------------------------------------------------------------ */
/* Audio availability — mirrors the engine's buffer map as $state so    */
/* the UI reacts when a clip is rendered (or its audio is dropped).     */
/* ------------------------------------------------------------------ */

export const audioReady = $state<Record<string, boolean>>({});

function markReady(clipId: string) {
	audioReady[clipId] = true;
}

function markGone(clipId: string) {
	delete audioReady[clipId];
}

export function clipHasAudio(clipId: string): boolean {
	return audioReady[clipId] === true;
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function charById(id: string | null | undefined): Character | undefined {
	return project.characters.find((c) => c.id === id);
}

export function clipById(clipId: string | null | undefined): Clip | undefined {
	if (!clipId) return undefined;
	for (const t of project.tracks) {
		const c = t.clips.find((c) => c.id === clipId);
		if (c) return c;
	}
	return undefined;
}

export function trackOfClip(clipId: string): Track | undefined {
	for (const t of project.tracks) {
		if (t.clips.some((c) => c.id === clipId)) return t;
	}
	return undefined;
}

export function effectiveDuration(clip: Clip): number {
	if (clip.type === 'sound' || clip.type === 'ambience') return clip.duration;
	return clip.rendered && clip.duration != null ? clip.duration : estimateDuration(clip.text);
}

export function totalDuration(): number {
	let maxEnd = 20;
	for (const t of project.tracks) {
		for (const c of t.clips) maxEnd = Math.max(maxEnd, c.start + effectiveDuration(c));
	}
	return maxEnd + 8;
}

function trackEnd(track: Track): number {
	return track.clips.reduce((m, c) => Math.max(m, c.start + effectiveDuration(c)), 0);
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export function snap(v: number): number {
	return Math.round(v * 20) / 20;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function addCharacter() {
	const defaultPreset = VOICE_PRESETS[0];
	const c = makeCharacter(
		'New Character',
		defaultPreset?.voiceId ?? ('fish-voice-' + (project.characters.length + 1)),
		'neutral',
		PALETTE[project.characters.length % PALETTE.length],
		defaultPreset?.gender,
		defaultPreset?.language ?? 'English',
		defaultPreset?.id
	);
	project.characters.push(c);
	toast(`Character “${c.name}” added`);
	return c;
}

export function removeCharacter(id: string) {
	project.characters = project.characters.filter((c) => c.id !== id);
	// clips of a removed character fall back to "Unassigned"
}

export function rerollFace(id: string) {
	const c = charById(id);
	if (!c) return;
	c.face = generate();
	toast(`New face for ${c.name}`);
}

/** Delete a character's avatar icon (also drops it from the export JSON). */
export function removeFace(id: string) {
	const c = charById(id);
	if (!c) return;
	c.face = undefined;
	toast(`Avatar removed for ${c.name}`);
}

export function addTrack(): Track {
	const trackNumber = project.tracks.length + 1;
	const t: Track = {
		id: nextId('track'),
		name: '',
		muted: false,
		clips: []
	};
	project.tracks.push(t);
	toast(`Lane ${trackNumber} added — drop any clip or sound on it`);
	return t;
}

export function removeTrack(id: string) {
	project.tracks = project.tracks.filter((t) => t.id !== id);
}

export function toggleMute(trackId: string) {
	const t = project.tracks.find((t) => t.id === trackId);
	if (!t) return;
	t.muted = !t.muted;
	toast(`${t.name}: ${t.muted ? 'muted' : 'unmuted'}`);
}

/** Add an empty dialogue clip at the end of a lane and open the editor. */
export function addLineClip(trackId: string) {
	const track = project.tracks.find((t) => t.id === trackId);
	if (!track) return;
	const c: DialogueClip = makeDialogue(
		nextId('clip'),
		project.characters[0]?.id ?? '',
		'',
		snap(trackEnd(track) + 0.3)
	);
	track.clips.push(c);
	ui.selectedClipId = c.id;
	ui.editingClipId = c.id;
	toast('Dialogue clip added — write the line');
}

/** Add a sound clip to a lane — at `start` (drop) or at the lane end (button). */
export function addSoundClip(trackId: string, preset: SoundPreset, start?: number) {
	const track = project.tracks.find((t) => t.id === trackId);
	if (!track) return;
	const c = makeSound(
		nextId('sfx'),
		preset.name,
		preset.icon,
		preset.duration,
		start ?? snap(trackEnd(track) + 0.2),
		{ fadeIn: 0.2, fadeOut: 0.2 }
	);
	track.clips.push(c);
	ui.selectedClipId = c.id;
	toast(`“${preset.name}” added to ${track.name}`);
}

/** Add a library category clip (Ambience, Music, or Sounds) to a lane */
export function addCategoryClip(trackId: string, category: SoundCategory, start?: number) {
	const track = project.tracks.find((t) => t.id === trackId);
	if (!track) return;
	const catInfo = SOUND_CATEGORIES.find((c) => c.id === category) || SOUND_CATEGORIES[0];
	const pos = start ?? snap(trackEnd(track) + 0.2);

	let clip: Clip;
	if (category === 'ambience') {
		clip = makeAmbience(nextId('amb'), 'Ambience Atmosphere', catInfo.defaultDuration, pos);
	} else if (category === 'music') {
		clip = makeSound(nextId('mus'), 'Music Track', catInfo.icon, catInfo.defaultDuration, pos, {
			fadeIn: 1.0,
			fadeOut: 1.0
		});
	} else {
		clip = makeSound(nextId('sfx'), 'Sound Effect', catInfo.icon, catInfo.defaultDuration, pos, {
			fadeIn: 0.1,
			fadeOut: 0.1
		});
	}

	track.clips.push(clip);
	ui.selectedClipId = clip.id;
	ui.editingClipId = clip.id;
	toast(`“${catInfo.name}” clip added to ${track.name}`);
	return clip;
}

export function moveClipToTrack(clipId: string, newTrackId: string) {
	const old = trackOfClip(clipId);
	const target = project.tracks.find((t) => t.id === newTrackId);
	if (!old || !target || old.id === target.id) return;
	const idx = old.clips.findIndex((c) => c.id === clipId);
	if (idx < 0) return;
	const [clip] = old.clips.splice(idx, 1);
	target.clips.push(clip);
}

export function deleteClip(clipId: string) {
	clearBuffer(clipId);
	markGone(clipId);
	void deleteCachedRender(clipId);
	for (const t of project.tracks) {
		const idx = t.clips.findIndex((c) => c.id === clipId);
		if (idx >= 0) {
			t.clips.splice(idx, 1);
			break;
		}
	}
	if (ui.editingClipId === clipId) ui.editingClipId = null;
	if (ui.fxClipId === clipId) ui.fxClipId = null;
	if (ui.selectedClipId === clipId) ui.selectedClipId = null;
}

export function duplicateClip(clipId: string) {
	const track = trackOfClip(clipId);
	const clip = clipById(clipId);
	if (!track || !clip) return;
	// NB: clips are $state deep proxies — structuredClone cannot clone those,
	// $state.snapshot takes a proper plain-data deep copy instead.
	const copy = $state.snapshot(clip);
	copy.id = nextId('clip');
	copy.start = snap(clip.start + effectiveDuration(clip) + 0.2);
	// A copy starts unrendered: its audio buffer belongs to the source clip.
	copy.rendered = false;
	copy.rendering = false;
	copy.waveform = [];
	if (copy.type === 'dialogue') {
		copy.duration = null;
		copy.renderError = null;
	}
	// sound/ambience keep their numeric duration; ambience keeps its layers
	track.clips.push(copy);
	ui.selectedClipId = copy.id;
	ui.editingClipId = copy.id;
	toast('Clip duplicated');
}

/** Render a dialogue clip with Fish Audio and decode it for playback. */
export async function regenerateClip(clipId: string): Promise<void> {
	const clip = clipById(clipId);
	if (!clip || clip.type !== 'dialogue' || clip.rendering) return;

	const text = clip.text.trim();
	if (!text) {
		clip.renderError = 'Nothing to render — write a line first';
		toast('Nothing to render — write a line first');
		return;
	}
	if (!settings.fishAudioApiKey) {
		clip.renderError = 'Add a Fish Audio API key in Settings';
		toast('Add a Fish Audio API key in Settings');
		ui.settingsOpen = true;
		return;
	}

	clip.rendering = true;
	clip.renderError = null;
	toast('Fish Audio rendering...');

	const character = charById(clip.characterId);
	const requestedText = text;
	const requestedVoice = character?.voiceId ?? '';
	try {
		await resumeContext();
		const buffer = await synthesize({
			text: toFishText(requestedText),
			referenceId: requestedVoice && !requestedVoice.startsWith('fish-voice-')
				? requestedVoice
				: '',
			model: settings.fishModel,
			apiKey: settings.fishAudioApiKey
		});

		// Text or voice changed while the request was in flight → discard the result.
		if (clip.text.trim() !== requestedText || (charById(clip.characterId)?.voiceId ?? '') !== requestedVoice) {
			return;
		}

		setBuffer(clip.id, buffer);
		markReady(clip.id);
		void cacheRenderedAudio(clip.id, buffer);
		clip.duration = +buffer.duration.toFixed(2);
		clip.waveform = computePeaks(buffer, 96);
		clip.rendered = true;
		clip.renderError = null;
		toast(`Rendered ${buffer.duration.toFixed(1)}s of audio`);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Render failed';
		clip.renderError = message;
		toast(`Render failed: ${message}`);
	} finally {
		clip.rendering = false;
	}
}

/**
 * Render an ambience clip by offline-mixing its enabled layers (at their knob
 * volumes, looped) into a single buffer of exactly the visible clip length.
 * The timeline waveform is derived from that real mix — no fake data.
 */
export async function renderAmbienceClip(clipId: string): Promise<void> {
	const clip = clipById(clipId);
	if (!clip || clip.type !== 'ambience' || clip.rendering) return;

	const active = (clip.layers || []).filter((l) => l.enabled && l.volume > 0.01);
	if (!active.length) {
		toast('Enable at least one layer with volume > 0 first');
		return;
	}

	clip.rendering = true;
	toast('Rendering ambience mix...');
	try {
		await resumeContext();
		const { ensureContext } = await import('./audio');
		const sampleRate = ensureContext().sampleRate || 44100;
		const parts = [];
		for (const layer of active) {
			const buffer = await loadAudioBuffer(layer.file);
			parts.push({ buffer, gain: layer.volume });
		}
		const mixed = await renderAmbienceMixdown(parts, clip.duration, sampleRate);
		setBuffer(clip.id, mixed);
		markReady(clip.id);
		void cacheRenderedAudio(clip.id, mixed);
		clip.waveform = computePeaks(mixed, 96);
		clip.rendered = true;
		toast(`Ambience mix rendered (${clip.duration.toFixed(1)}s)`);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Render failed';
		toast(`Ambience render failed: ${message}`);
	} finally {
		clip.rendering = false;
	}
}

/**
 * Edited text or a new voice makes the rendered audio stale — drop it so the
 * timeline never plays audio that no longer matches the script.
 */
export function invalidateRender(clipId: string) {
	const clip = clipById(clipId);
	if (!clip || clip.type !== 'dialogue') return;
	if (!clip.rendered && !hasAudio(clip.id)) return;
	clearBuffer(clip.id);
	markGone(clip.id);
	void deleteCachedRender(clip.id);
	clip.rendered = false;
	clip.duration = null;
	clip.waveform = [];
	clip.renderError = null;
}

/** Render every dialogue clip that has audio missing. */
export async function renderAllClips(): Promise<void> {
	const pending: string[] = [];
	for (const t of project.tracks) {
		for (const c of t.clips) {
			if (c.type === 'dialogue' && !hasAudio(c.id) && c.text.trim()) pending.push(c.id);
		}
	}
	if (!pending.length) {
		toast('Nothing left to render');
		return;
	}
	toast(`Rendering ${pending.length} clip${pending.length === 1 ? '' : 's'}...`);
	// Sequential: Fish Audio rate-limits concurrent synthesis requests.
	for (const id of pending) {
		await regenerateClip(id);
	}
}

/**
 * Linear playback gain from a clip's Loudness FX (dB → linear). 1 when the
 * effect is absent or bypassed. Currently honored for dialogue clips.
 */
export function clipLoudnessGain(clip: Clip): number {
	if (clip.type !== 'dialogue') return 1;
	const loud = clipEffects(clip).find((f) => f.name === 'Loudness' && f.on);
	const param = loud?.params.find((p) => p.name === 'Gain') ?? loud?.params[0];
	if (!loud || !param) return 1;
	const db = Math.max(-24, Math.min(24, param.value));
	return +Math.pow(10, db / 20).toFixed(4);
}

/**
 * Normalize voice loudness: measure every rendered dialogue clip (RMS dB),
 * average per character, then write a Loudness FX onto each rendered clip so
 * every voice lands on the shared average. Clips without audio are skipped.
 */
export function normalizeVoiceClips(): void {
	const byChar = new Map<string, number[]>();
	for (const t of project.tracks) {
		for (const c of t.clips) {
			if (c.type !== 'dialogue') continue;
			const buffer = getBuffer(c.id);
			if (!buffer) continue;
			const arr = byChar.get(c.characterId) ?? [];
			arr.push(measureLoudnessDb(buffer));
			byChar.set(c.characterId, arr);
		}
	}
	if (!byChar.size) {
		toast('Nothing to normalize — render voice clips first');
		return;
	}
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const avgs = [...byChar].map(([id, dbs]) => ({ id, db: mean(dbs) }));
	const target = +mean(avgs.map((a) => a.db)).toFixed(1);

	let n = 0;
	for (const { id, db } of avgs) {
		const gainDb = +Math.max(-24, Math.min(24, target - db)).toFixed(1);
		for (const t of project.tracks) {
			for (const c of t.clips) {
				if (c.type !== 'dialogue' || c.characterId !== id || !getBuffer(c.id)) continue;
				const fx = clipEffects(c);
				let loud = fx.find((f) => f.name === 'Loudness');
				if (!loud) {
					loud = { id: nextId('fx'), name: 'Loudness', on: true, params: makeEffectParams('Loudness') };
					fx.push(loud);
				}
				const param = loud.params.find((p) => p.name === 'Gain') ?? loud.params[0];
				if (!param) continue;
				param.value = gainDb;
				loud.on = true;
				n++;
			}
		}
	}
	toast(`Voices normalized to ${target.toFixed(1)} dB — Loudness FX set on ${n} clip${n === 1 ? '' : 's'}`);
}

/**
 * Load an MP3 (or any decodable audio file) from the computer onto a sound
 * clip. Bytes go to the IndexedDB audio cache — never localStorage — and the
 * project JSON keeps only the file reference. Clip length follows the audio.
 */
export async function importSoundFile(clipId: string, file: File): Promise<void> {
	const clip = clipById(clipId);
	if (!clip || clip.type !== 'sound') return;
	try {
		const raw = await file.arrayBuffer();
		const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-60) || 'audio';
		const fileId = `upload:${Date.now()}-${safe}`;
		// Decode first (validates the file), then persist the bytes.
		const buffer = await decodeAudioBytes(raw.slice(0));
		await saveUploadedAudio(fileId, raw);
		clip.file = fileId;
		if (!clip.name || clip.name === 'Sound Effect') {
			clip.name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || clip.name;
		}
		clip.duration = +buffer.duration.toFixed(2);
		clip.waveform = computePeaks(buffer, 96);
		clip.rendered = true;
		setBuffer(clip.id, buffer);
		markReady(clip.id);
		toast(`Sound loaded (${buffer.duration.toFixed(1)}s) — cached, JSON keeps the reference`);
	} catch {
		toast('Could not decode that audio file');
	}
}

/**
 * Resolve a sound clip's audio: session memory first, then the uploads cache
 * (user files) or the asset pipeline (library URLs).
 */
export async function resolveSoundBuffer(clip: SoundClip): Promise<AudioBuffer | null> {
	const mem = getBuffer(clip.id);
	if (mem) return mem;
	if (!clip.file) return null;
	try {
		const buffer = clip.file.startsWith('upload:')
			? await loadUploadedAudio(clip.file)
			: await loadAudioBuffer(clip.file);
		if (buffer) setBuffer(clip.id, buffer);
		return buffer;
	} catch {
		return null;
	}
}

/**
 * Rehydrate persisted renders after a page reload: for every clip that was
 * rendered (dialogue synthesis or ambience mixdown), decode its cached WAV
 * bytes back into a playable buffer. Runs once at startup.
 */
export async function restoreCachedAudio(): Promise<void> {
	let n = 0;
	for (const t of project.tracks) {
		for (const c of t.clips) {
			if (
				(c.type === 'dialogue' || c.type === 'ambience') &&
				c.rendered &&
				c.waveform.length &&
				!hasAudio(c.id)
			) {
				try {
					const buffer = await loadCachedRender(c.id);
					if (buffer) {
						setBuffer(c.id, buffer);
						markReady(c.id);
						n++;
					}
				} catch {
					/* corrupt entry — clip simply needs a re-render */
				}
			}
		}
	}
	if (n) toast(`Restored ${n} cached render${n === 1 ? '' : 's'}`);
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

async function collectScheduledAsync(): Promise<ScheduledClip[]> {
	const out: ScheduledClip[] = [];
	for (const track of project.tracks) {
		if (track.muted) continue;
		for (const clip of track.clips) {
			if (clip.type === 'dialogue') {
				const buffer = getBuffer(clip.id);
				if (!buffer) continue;
				out.push({
					id: clip.id,
					start: clip.start,
					duration: Math.min(effectiveDuration(clip), buffer.duration),
					fadeIn: clip.fadeIn,
					fadeOut: clip.fadeOut,
					buffer,
					gain: clipLoudnessGain(clip)
				});
			} else if (clip.type === 'ambience') {
				// Prefer the rendered visible-length mixdown (matches the waveform).
				const mixed = getBuffer(clip.id);
				if (mixed) {
					out.push({
						id: clip.id,
						start: clip.start,
						duration: Math.min(clip.duration, mixed.duration),
						fadeIn: clip.fadeIn,
						fadeOut: clip.fadeOut,
						buffer: mixed
					});
					continue;
				}
				// Fallback: live-mix layers (e.g. never rendered).
				const activeLayers = (clip.layers || []).filter((l) => l.enabled && l.volume > 0.01);
				for (const layer of activeLayers) {
					try {
						const buffer = await loadAudioBuffer(layer.file);
						out.push({
							id: `${clip.id}-${layer.id}`,
							start: clip.start,
							duration: clip.duration,
							fadeIn: clip.fadeIn,
							fadeOut: clip.fadeOut,
							buffer,
							loop: true,
							gain: layer.volume
						});
					} catch (err) {
						console.warn(`Could not load layer ${layer.name}:`, err);
					}
				}
			} else if (clip.type === 'sound') {
				const buffer = await resolveSoundBuffer(clip);
				if (!buffer) {
					if (clip.file) console.warn(`Could not load sound ${clip.name}`);
					continue;
				}
				out.push({
					id: clip.id,
					start: clip.start,
					duration: Math.min(clip.duration, buffer.duration),
					fadeIn: clip.fadeIn,
					fadeOut: clip.fadeOut,
					buffer
				});
			}
		}
	}
	return out;
}

let playTimer: ReturnType<typeof setInterval> | null = null;
/** Guards the async startup window so a fast double-press can't start playback twice. */
let starting = false;

export async function togglePlay() {
	if (ui.playing) {
		stopPlay();
		return;
	}
	if (starting) return;
	starting = true;
	try {
		await resumeContext();
		const scheduled = await collectScheduledAsync();
		if (!scheduled.length) {
			toast('No audio to play — render dialogue clips or enable an ambience loop');
			return;
		}

		const from = ui.playhead >= totalDuration() - 0.05 ? 0 : ui.playhead;
		startPlayback(scheduled, from);
		ui.playing = true;

		// Drive the display from the audio clock on a timer (rAF is paused in
		// background/embedded contexts, which would leave the playhead stuck).
		playTimer = setInterval(() => {
			if (!ui.playing) return;
			const t = elapsed();
			if (t >= totalDuration()) {
				ui.playhead = 0;
				stopPlay(false);
				return;
			}
			ui.playhead = +t.toFixed(2);
		}, 50);
	} finally {
		starting = false;
	}
}

function hasFishKey(): boolean {
	return !!settings.fishAudioApiKey;
}

/**
 * Pause playback. By default the playhead is frozen at the exact audio-clock
 * position (not the last 50ms display tick), so resume continues precisely
 * where you stopped. Pass false when the caller sets the playhead itself.
 */
export function stopPlay(freezeAtAudioTime = true) {
	if (freezeAtAudioTime && ui.playing) {
		try {
			ui.playhead = +elapsed().toFixed(2);
		} catch {
			/* keep last known playhead */
		}
	}
	stopPlayback();
	if (playTimer) {
		clearInterval(playTimer);
		playTimer = null;
	}
	ui.playing = false;
}

export function seek(s: number) {
	const wasPlaying = ui.playing;
	ui.playhead = Math.max(0, s);
	if (wasPlaying) {
		stopPlay(false);
		void togglePlay();
	}
}

export function resetPlayhead() {
	const wasPlaying = ui.playing;
	if (wasPlaying) stopPlay();
	ui.playhead = 0;
}

/**
 * Bounce the full timeline (all unmuted lanes, fades, loudness gains and
 * looping ambience) to an MP3 blob for download. Returns null when there is
 * nothing renderable yet.
 */
export async function exportTimelineMp3(): Promise<{ blob: Blob; duration: number } | null> {
	const scheduled = await collectScheduledAsync();
	if (!scheduled.length) {
		toast('Nothing to export — render clips first');
		return null;
	}
	const { renderOfflineMixdown } = await import('./audio');
	const { encodeMp3 } = await import('./mp3');
	const total = totalDuration();
	const mixed = await renderOfflineMixdown(scheduled, total);
	return { blob: await encodeMp3(mixed), duration: total };
}

/* ------------------------------------------------------------------ */
/* Export / Import                                                     */
/*                                                                     */
/* The JSON carries structure only — no audio. Rendered dialogue and    */
/* ambience mixdowns are NOT included, so imported clips come back      */
/* unrendered (waveforms for library sounds are regenerated) and need  */
/* a re-render before playback.                                        */
/* ------------------------------------------------------------------ */

export function buildExport() {
	return {
		version: 1,
		project: project.name,
		engine: 'fish-audio',
		characters: project.characters.map((c) => ({
			id: c.id,
			name: c.name,
			color: c.color,
			voiceId: c.voiceId,
			defaultEmotion: c.emotion,
			// Omit the bulky face object when no avatar is set.
			...(c.face ? { face: c.face } : {})
		})),
		tracks: project.tracks.map((t) => ({
			id: t.id,
			name: t.name,
			muted: t.muted,
			clips: t.clips.map((c) =>
				c.type === 'dialogue'
					? {
							id: c.id,
							type: 'dialogue',
							characterId: c.characterId,
							text: c.text,
							start: round2(c.start),
							duration: round2(effectiveDuration(c)),
							rendered: c.rendered,
							fadeIn: round2(c.fadeIn),
							fadeOut: round2(c.fadeOut),
							effects: clipEffects(c).filter((e) => e.on).map((e) => e.name)
						}
					: c.type === 'ambience'
						? {
								id: c.id,
								type: 'ambience',
								name: c.name,
								icon: c.icon,
								start: round2(c.start),
								duration: round2(c.duration),
								fadeIn: round2(c.fadeIn),
								fadeOut: round2(c.fadeOut),
								layers: (c.layers || []).map((l) => ({
									id: l.id,
									name: l.name,
									icon: l.icon,
									file: l.file,
									volume: +l.volume.toFixed(3),
									enabled: l.enabled
								})),
								effects: clipEffects(c).filter((e) => e.on).map((e) => e.name)
							}
						: {
								id: c.id,
								type: 'sound',
								name: c.name,
								icon: c.icon,
								start: round2(c.start),
								duration: round2(c.duration),
								fadeIn: round2(c.fadeIn),
								fadeOut: round2(c.fadeOut),
								// Audio bytes stay in the cache — the JSON keeps only the reference.
								...(c.file ? { file: c.file } : {}),
								effects: clipEffects(c).filter((e) => e.on).map((e) => e.name)
							}
			)
		}))
	};
}

type ImportResult = { ok: true } | { ok: false; error: string };

function importStr(v: unknown, fallback: string): string {
	return typeof v === 'string' && v ? v : fallback;
}

function importNum(v: unknown, fallback: number, min = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, +v.toFixed(2)) : fallback;
}

function importEffects(names: unknown): AudioEffect[] {
	const all = defaultEffects();
	if (!Array.isArray(names)) return all;
	const on = new Set(names.filter((n): n is string => typeof n === 'string'));
	for (const fx of all) fx.on = on.has(fx.name);
	return all;
}

/**
 * Load a project from pasted export JSON, replacing the current project.
 * Structure-only: clips come back unrendered (no audio in the JSON) and any
 * in-memory/cached audio of the replaced project is dropped.
 */
export function importProject(raw: string): ImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Invalid JSON — check for typos or truncation.' };
	}
	if (!parsed || typeof parsed !== 'object') {
		return { ok: false, error: 'Not a project export (expected a JSON object).' };
	}
	const data = parsed as Record<string, unknown>;
	if (!Array.isArray(data.tracks) || !Array.isArray(data.characters)) {
		return { ok: false, error: 'Not a project export (missing tracks or characters).' };
	}

	try {
		const characters: Character[] = (data.characters as unknown[]).map((rawC, i) => {
			const c = (rawC ?? {}) as Record<string, unknown>;
			const voiceId = importStr(c.voiceId, `fish-voice-imported-${i + 1}`);
			return {
				id: importStr(c.id, nextId('char')),
				name: importStr(c.name, `Character ${i + 1}`),
				voiceId,
				language: importStr(c.language, 'English'),
				voicePreset: undefined,
				color: importStr(c.color, PALETTE[i % PALETTE.length]),
				emotion: importStr(c.defaultEmotion ?? c.emotion, 'neutral'),
				// Avatar stays absent unless the JSON carries one.
				face:
					c.face && typeof c.face === 'object' ? (c.face as FaceConfig) : undefined
			};
		});

		const tracks: Track[] = (data.tracks as unknown[]).map((rawT, ti) => {
			const t = (rawT ?? {}) as Record<string, unknown>;
			const clips: Clip[] = Array.isArray(t.clips)
				? (t.clips as unknown[]).flatMap((rawC): Clip[] => {
						const c = (rawC ?? {}) as Record<string, unknown>;
						const type = c.type === 'dialogue' || c.type === 'ambience' ? c.type : 'sound';
						const start = importNum(c.start, 0);
						const fadeIn = importNum(c.fadeIn, 0);
						const fadeOut = importNum(c.fadeOut, 0);
						const id = importStr(c.id, nextId('clip'));
						if (type === 'dialogue') {
							const clip: DialogueClip = {
								id,
								type: 'dialogue',
								characterId: importStr(c.characterId, ''),
								text: importStr(c.text, ''),
								start,
								fadeIn,
								fadeOut,
								rendered: false,
								rendering: false,
								duration: null,
								waveform: [],
								effects: importEffects(c.effects),
								renderError: null
							};
							return [clip];
						}
						if (type === 'ambience') {
							const layers = Array.isArray(c.layers)
								? (c.layers as unknown[]).map((rawL, li) => {
										const l = (rawL ?? {}) as Record<string, unknown>;
										const volume =
											typeof l.volume === 'number' && Number.isFinite(l.volume)
												? Math.max(0, Math.min(1, l.volume))
												: 0.5;
										return {
											id: importStr(l.id, `ambience-imported-${li}`),
											name: importStr(l.name, `Layer ${li + 1}`),
											icon: importStr(l.icon, 'graphic_eq'),
											file: importStr(l.file, ''),
											volume,
											enabled: l.enabled !== false && volume > 0
										};
									})
								: [];
							const clip: AmbienceClip = {
								id,
								type: 'ambience',
								name: importStr(c.name, 'Ambience Atmosphere'),
								icon: importStr(c.icon, 'filter_drama'),
								duration: importNum(c.duration, 10, 0.3),
								start,
								fadeIn,
								fadeOut,
								rendered: false,
								rendering: false,
								waveform: [],
								layers,
								effects: importEffects(c.effects)
							};
							return [clip];
						}
						const fileRef = typeof c.file === 'string' && c.file ? c.file : undefined;
						const clip: SoundClip = {
							id,
							type: 'sound',
							name: importStr(c.name, 'Sound Effect'),
							icon: importStr(c.icon, 'volume_up'),
							duration: importNum(c.duration, 2, 0.2),
							start,
							fadeIn,
							fadeOut,
							rendered: true,
							rendering: false,
							// Waveform returns once the referenced audio resolves
							// (same-browser cache) — otherwise it stays empty.
							waveform: [],
							file: fileRef,
							effects: importEffects(c.effects)
						};
						return [clip];
					})
				: [];
			return {
				id: importStr(t.id, nextId('track')),
				name: importStr(t.name, `Lane ${ti + 1}`),
				muted: t.muted === true,
				clips
			};
		});

		if (!tracks.length) return { ok: false, error: 'The export contains no lanes.' };

		// Drop the replaced project's audio (memory + persisted renders).
		stopPlay();
		for (const t of project.tracks) {
			for (const c of t.clips) {
				clearBuffer(c.id);
				markGone(c.id);
				void deleteCachedRender(c.id);
			}
		}

		const incoming: Project = {
			name: importStr(data.project, 'Imported Project'),
			characters,
			tracks
		};
		normalizeProject(incoming);
		syncIdCounter(incoming);
		project.name = incoming.name;
		project.characters = incoming.characters;
		project.tracks = incoming.tracks;

		ui.selectedClipId = null;
		ui.editingClipId = null;
		ui.fxClipId = null;
		ui.playhead = 0;
		saveProjectNow();

		// Same-browser round-trip: re-resolve referenced sound files from the
		// uploads cache so waveforms and playback come back without re-upload.
		for (const t of project.tracks) {
			for (const c of t.clips) {
				if (c.type !== 'sound' || !c.file) continue;
				void resolveSoundBuffer(c).then((buffer) => {
					if (!buffer) return;
					c.waveform = computePeaks(buffer, 96);
					c.duration = Math.min(c.duration, +buffer.duration.toFixed(2));
					markReady(c.id);
				});
			}
		}

		const clipCount = tracks.reduce((n, t) => n + t.clips.length, 0);
		toast(`Project “${project.name}” loaded (${clipCount} clips — re-render audio to play)`);
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? `Could not load project: ${e.message}` : 'Could not load project.'
		};
	}
}
