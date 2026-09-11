// runes ($state) are compiler-injected in .svelte.ts files — no import needed
import { generate } from 'facesjs';
import type { FaceConfig } from 'facesjs';
import type {
	AmbienceClip,
	AmbienceLayer,
	Character,
	Clip,
	DialogueClip,
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

export const EFFECT_PRESETS = [
	{ name: 'Echo', on: true, value: '18%' },
	{ name: 'Delay', on: false, value: '240 ms' },
	{ name: 'Pitch', on: false, value: '+0.0 st' },
	{ name: 'Reverb', on: true, value: '12%' },
	{ name: 'Compressor', on: false, value: '-3 dB' }
];

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
		face: generate(undefined, gender ? { gender } : undefined)
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
		effects: EFFECT_PRESETS.map((e) => ({ ...e }))
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
		waveform: genWaveform(id, 64)
	};
}

export function makeAmbience(
	id: string,
	name: string,
	duration: number,
	start: number,
	initialActiveIds: string[] = ['ambience-cabin-rain-cabin'],
	opts: Partial<Pick<AmbienceClip, 'fadeIn' | 'fadeOut'>> = {}
): AmbienceClip {
	const allLayers: AmbienceLayer[] = (audioCatalog.ambience || []).map((item) => {
		const isInitial = initialActiveIds.includes(item.id);
		return {
			id: item.id,
			name: item.name,
			icon: item.icon,
			file: item.file,
			volume: isInitial ? 0.5 : 0,
			enabled: isInitial
		};
	});

	// Use the first active layer's icon, or the first layer's icon as fallback
	const primaryIcon = allLayers.find(l => l.enabled)?.icon || allLayers[0]?.icon || 'filter_drama';

	return {
		id,
		type: 'ambience',
		name,
		icon: primaryIcon,
		duration,
		start,
		fadeIn: opts.fadeIn ?? 1.5,
		fadeOut: opts.fadeOut ?? 2.0,
		rendered: true,
		rendering: false,
		waveform: genWaveform(id, 64),
		layers: allLayers
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
			makeAmbience('a1', 'Rainy Night Atmosphere', 28, 0, [
				'ambience-cabin-rain-cabin',
				'ambience-autumn-wind-air'
			], { fadeIn: 1.5, fadeOut: 2.5 }),
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

export const project = $state<Project>(initialProject());

export const ui = $state({
	tab: 'timeline' as 'timeline' | 'characters' | 'export',
	/** px per second on the timeline */
	zoom: 70,
	playhead: 0,
	playing: false,
	selectedClipId: null as string | null,
	editingClipId: null as string | null,
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

export function addTrack(): Track {
	const t: Track = {
		id: nextId('track'),
		name: 'New Lane',
		muted: false,
		clips: []
	};
	project.tracks.push(t);
	toast('Lane added — drop any clip or sound on it');
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
	for (const t of project.tracks) {
		const idx = t.clips.findIndex((c) => c.id === clipId);
		if (idx >= 0) {
			t.clips.splice(idx, 1);
			break;
		}
	}
	if (ui.editingClipId === clipId) ui.editingClipId = null;
	if (ui.selectedClipId === clipId) ui.selectedClipId = null;
}

export function duplicateClip(clipId: string) {
	const track = trackOfClip(clipId);
	const clip = clipById(clipId);
	if (!track || !clip) return;
	const copy = structuredClone(clip);
	copy.id = nextId('clip');
	copy.start = snap(clip.start + effectiveDuration(clip) + 0.2);
	// A copy starts unrendered: its audio buffer belongs to the source clip.
	copy.rendered = false;
	copy.rendering = false;
	copy.duration = null;
	copy.waveform = [];
	if (copy.type === 'dialogue') copy.renderError = null;
	track.clips.push(copy);
	ui.selectedClipId = copy.id;
	ui.editingClipId = copy.id;
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
 * Edited text or a new voice makes the rendered audio stale — drop it so the
 * timeline never plays audio that no longer matches the script.
 */
export function invalidateRender(clipId: string) {
	const clip = clipById(clipId);
	if (!clip || clip.type !== 'dialogue') return;
	if (!clip.rendered && !hasAudio(clip.id)) return;
	clearBuffer(clip.id);
	markGone(clip.id);
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
					buffer
				});
			} else if (clip.type === 'ambience') {
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
			} else if (clip.type === 'sound' && clip.file) {
				try {
					const buffer = await loadAudioBuffer(clip.file);
					out.push({
						id: clip.id,
						start: clip.start,
						duration: Math.min(clip.duration, buffer.duration),
						fadeIn: clip.fadeIn,
						fadeOut: clip.fadeOut,
						buffer
					});
				} catch (err) {
					console.warn(`Could not load sound ${clip.name}:`, err);
				}
			}
		}
	}
	return out;
}

let playTimer: ReturnType<typeof setInterval> | null = null;

export async function togglePlay() {
	if (ui.playing) {
		stopPlay();
		return;
	}

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
			stopPlay();
			return;
		}
		ui.playhead = +t.toFixed(2);
	}, 50);
}

function hasFishKey(): boolean {
	return !!settings.fishAudioApiKey;
}

export function stopPlay() {
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
		stopPlay();
		void togglePlay();
	}
}

export function resetPlayhead() {
	const wasPlaying = ui.playing;
	if (wasPlaying) stopPlay();
	ui.playhead = 0;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
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
			face: c.face
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
							effects: c.effects.filter((e) => e.on).map((e) => e.name)
						}
					: {
							id: c.id,
							type: 'sound',
							name: c.name,
							icon: c.icon,
							start: round2(c.start),
							duration: round2(c.duration),
							fadeIn: round2(c.fadeIn),
							fadeOut: round2(c.fadeOut)
						}
			)
		}))
	};
}
