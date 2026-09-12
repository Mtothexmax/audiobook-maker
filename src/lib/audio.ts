/**
 * Web Audio playback engine + Fish Audio synthesis client.
 *
 * Rendered clips are kept as decoded AudioBuffers in memory, keyed by clip id.
 * Playback schedules one BufferSource per clip on a shared AudioContext, with
 * gain envelopes for fade in/out and an optional trimmed length.
 *
 * Audio buffers are cached in IndexedDB to avoid re-fetching/decoding on reload.
 */

const IDB_DB_NAME = 'audioboook-maker-audio-cache';
const IDB_STORE_NAME = 'buffers';
const IDB_RENDERS_STORE = 'renders';
const IDB_UPLOADS_STORE = 'uploads';
const IDB_VERSION = 3;

interface CachedAudioBuffer {
	url: string;
	buffer: AudioBuffer;
	timestamp: number;
}

let idb: IDBDatabase | null = null;

async function initIDB(): Promise<IDBDatabase> {
	if (idb) return idb;
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			idb = request.result;
			resolve(idb);
		};
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
				db.createObjectStore(IDB_STORE_NAME, { keyPath: 'url' });
			}
			if (!db.objectStoreNames.contains(IDB_RENDERS_STORE)) {
				db.createObjectStore(IDB_RENDERS_STORE, { keyPath: 'clipId' });
			}
			if (!db.objectStoreNames.contains(IDB_UPLOADS_STORE)) {
				db.createObjectStore(IDB_UPLOADS_STORE, { keyPath: 'fileId' });
			}
		};
	});
}

async function getCachedBuffer(url: string): Promise<AudioBuffer | null> {
	try {
		const db = await initIDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE_NAME, 'readonly');
			const store = tx.objectStore(IDB_STORE_NAME);
			const request = store.get(url);
			request.onsuccess = () => {
				if (request.result?.buffer) {
					resolve(request.result.buffer);
				} else {
					resolve(null);
				}
			};
			request.onerror = () => resolve(null);
		});
	} catch {
		return null;
	}
}

async function setCachedBuffer(url: string, buffer: AudioBuffer): Promise<void> {
	try {
		const db = await initIDB();
		const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
		const store = tx.objectStore(IDB_STORE_NAME);
		store.put({ url, buffer, timestamp: Date.now() });
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Ignore IndexedDB errors (quota, private browsing, etc.)
	}
}

/** Encode a buffer as 16-bit PCM WAV bytes (for persisting renders in IndexedDB). */
export function encodeWAV(buffer: AudioBuffer): ArrayBuffer {
	const numCh = Math.min(2, buffer.numberOfChannels);
	const sampleRate = buffer.sampleRate;
	const len = buffer.length;
	const blockAlign = numCh * 2;
	const dataSize = len * blockAlign;
	const ab = new ArrayBuffer(44 + dataSize);
	const v = new DataView(ab);
	const writeStr = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
	};
	writeStr(0, 'RIFF');
	v.setUint32(4, 36 + dataSize, true);
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, numCh, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * blockAlign, true);
	v.setUint16(32, blockAlign, true);
	v.setUint16(34, 16, true);
	writeStr(36, 'data');
	v.setUint32(40, dataSize, true);
	const chans: Float32Array[] = [];
	for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
	let off = 44;
	for (let i = 0; i < len; i++) {
		for (let c = 0; c < numCh; c++) {
			const s = Math.max(-1, Math.min(1, chans[c][i]));
			v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			off += 2;
		}
	}
	return ab;
}

/** Decode bytes without touching the realtime AudioContext (no autoplay-policy warning). */
export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
	const ctx = new OfflineAudioContext(1, 1, 44100);
	return await ctx.decodeAudioData(bytes.slice(0));
}

/** Persist a user-uploaded audio file (MP3 etc.) by file id. Project JSON keeps only the id. */
export async function saveUploadedAudio(fileId: string, audio: ArrayBuffer): Promise<void> {
	try {
		const db = await initIDB();
		const tx = db.transaction(IDB_UPLOADS_STORE, 'readwrite');
		tx.objectStore(IDB_UPLOADS_STORE).put({ fileId, audio, timestamp: Date.now() });
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Ignore IndexedDB errors (quota, private browsing, etc.)
	}
}

const uploadBuffers = new Map<string, Promise<AudioBuffer>>();

/** Load uploaded audio back (session memory cache + IndexedDB), or null if absent. */
export async function loadUploadedAudio(fileId: string): Promise<AudioBuffer | null> {
	const cached = uploadBuffers.get(fileId);
	if (cached) {
		try {
			return await cached;
		} catch {
			uploadBuffers.delete(fileId);
			return null;
		}
	}
	const p = (async () => {
		const db = await initIDB();
		const record = await new Promise<{ audio?: ArrayBuffer } | undefined>((resolve) => {
			const tx = db.transaction(IDB_UPLOADS_STORE, 'readonly');
			const request = tx.objectStore(IDB_UPLOADS_STORE).get(fileId);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(undefined);
		});
		if (!record?.audio || !(record.audio instanceof ArrayBuffer) || !record.audio.byteLength) {
			throw new Error('uploaded audio not found in cache');
		}
		return await decodeAudioBytes(record.audio);
	})();
	uploadBuffers.set(fileId, p);
	try {
		return await p;
	} catch {
		uploadBuffers.delete(fileId);
		return null;
	}
}

/** Persist a rendered clip (dialogue synthesis or ambience mixdown) across reloads. */
export async function cacheRenderedAudio(clipId: string, buffer: AudioBuffer): Promise<void> {
	try {
		const db = await initIDB();
		const audio = encodeWAV(buffer);
		const tx = db.transaction(IDB_RENDERS_STORE, 'readwrite');
		tx.objectStore(IDB_RENDERS_STORE).put({ clipId, audio, timestamp: Date.now() });
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Ignore IndexedDB errors (quota, private browsing, etc.)
	}
}

/** Load a persisted render back into a playable AudioBuffer, or null if absent. */
export async function loadCachedRender(clipId: string): Promise<AudioBuffer | null> {
	try {
		const db = await initIDB();
		const record = await new Promise<{ audio?: ArrayBuffer } | undefined>((resolve) => {
			const tx = db.transaction(IDB_RENDERS_STORE, 'readonly');
			const request = tx.objectStore(IDB_RENDERS_STORE).get(clipId);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(undefined);
		});
		if (!record?.audio || !(record.audio instanceof ArrayBuffer) || !record.audio.byteLength) {
			return null;
		}
		return await decodeAudioBytes(record.audio);
	} catch {
		return null;
	}
}

/** Drop a persisted render (clip deleted or invalidated). */
export async function deleteCachedRender(clipId: string): Promise<void> {
	try {
		const db = await initIDB();
		const tx = db.transaction(IDB_RENDERS_STORE, 'readwrite');
		tx.objectStore(IDB_RENDERS_STORE).delete(clipId);
		await new Promise<void>((resolve) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => resolve();
		});
	} catch {
		/* ignore */
	}
}

export interface ScheduledClip {
	id: string;
	/** seconds from timeline start */
	start: number;
	/** playable length in seconds (already trimmed) */
	duration: number;
	fadeIn: number;
	fadeOut: number;
	buffer: AudioBuffer;
	/** loop audio file (e.g. for ambience) */
	loop?: boolean;
	/** individual layer gain 0..1 (defaults to 1) */
	gain?: number;
}

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const urlBuffers = new Map<string, Promise<AudioBuffer>>();

/** Lazily create the shared AudioContext (must be resumed on a user gesture). */
export function ensureContext(): AudioContext {
	if (!ctx) {
		const Ctor: typeof AudioContext =
			typeof window !== 'undefined'
				? (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
				: (undefined as unknown as typeof AudioContext);
		ctx = new Ctor();
	}
	return ctx;
}

export async function resumeContext(): Promise<void> {
	const c = ensureContext();
	if (c.state === 'suspended') await c.resume();
}

export function setBuffer(clipId: string, buffer: AudioBuffer): void {
	buffers.set(clipId, buffer);
}

export function getBuffer(clipId: string): AudioBuffer | undefined {
	return buffers.get(clipId);
}

export function hasAudio(clipId: string): boolean {
	return buffers.has(clipId);
}

export function clearBuffer(clipId: string): void {
	buffers.delete(clipId);
}

/** Fetch and decode an audio file from an asset URL with in-memory + IndexedDB caching. */
export async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
	const cached = urlBuffers.get(url);
	if (cached) return cached;

	const p = (async () => {
		// Try IndexedDB first
		const idbBuffer = await getCachedBuffer(url);
		if (idbBuffer) return idbBuffer;

		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to load audio asset: ${res.statusText}`);
		const arrayBuffer = await res.arrayBuffer();
		const c = ensureContext();
		const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
			const promise = c.decodeAudioData(arrayBuffer, resolve, reject);
			if (promise && typeof promise.then === 'function') promise.then(resolve, reject);
		});
		// Cache in IndexedDB for future sessions
		await setCachedBuffer(url, buffer);
		return buffer;
	})();

	urlBuffers.set(url, p);
	return p;
}

/**
 * Send text to the server-side Fish Audio proxy and decode the returned audio.
 * Throws an Error with a human-readable message on failure.
 */
export async function synthesize(opts: {
	text: string;
	referenceId: string;
	model: string;
	apiKey: string;
}): Promise<AudioBuffer> {
	const res = await fetch('/api/tts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(opts)
	});

	if (!res.ok) {
		let message = `Request failed (${res.status})`;
		try {
			const body = await res.json();
			if (body?.error) message = body.error;
		} catch {
			/* non-JSON error body */
		}
		throw new Error(message);
	}

	const bytes = await res.arrayBuffer();
	if (!bytes.byteLength) throw new Error('Fish Audio returned empty audio');

	const c = ensureContext();
	// Some Safari versions still use the callback form.
	return await new Promise<AudioBuffer>((resolve, reject) => {
		const promise = c.decodeAudioData(bytes, resolve, reject);
		if (promise && typeof promise.then === 'function') promise.then(resolve, reject);
	});
}

/**
 * Offline-mix enabled ambience layers into a single buffer of exactly
 * `durationSeconds` length. Each layer loops to fill the visible clip length
 * and is summed at its knob volume — so we never render more than the
 * timeline shows. Fades are NOT baked in (playback applies them live via
 * gain envelopes), keeping the waveform a true picture of the loop content.
 */
export async function renderAmbienceMixdown(
	layers: { buffer: AudioBuffer; gain: number }[],
	durationSeconds: number,
	sampleRate: number
): Promise<AudioBuffer> {
	const seconds = Math.max(0.3, durationSeconds);
	const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
	for (const layer of layers) {
		if (layer.gain <= 0.001) continue;
		const src = ctx.createBufferSource();
		src.buffer = layer.buffer;
		src.loop = true;
		const g = ctx.createGain();
		g.gain.value = Math.max(0, Math.min(1, layer.gain));
		src.connect(g);
		g.connect(ctx.destination);
		src.start(0);
		src.stop(seconds);
	}
	return await ctx.startRendering();
}

/** Peak envelope of the first channel, normalised to 0..1, for real waveforms. */
export function computePeaks(buffer: AudioBuffer, n = 96): number[] {
	const data = buffer.getChannelData(0);
	const block = Math.max(1, Math.floor(data.length / n));
	const out: number[] = [];
	let max = 0;
	for (let i = 0; i < n; i++) {
		const start = i * block;
		const end = Math.min(data.length, start + block);
		let peak = 0;
		for (let j = start; j < end; j++) {
			const v = Math.abs(data[j]);
			if (v > peak) peak = v;
		}
		out.push(peak);
		if (peak > max) max = peak;
	}
	return max > 0 ? out.map((v) => +(v / max).toFixed(3)) : out;
}

/** Loudness estimate in dBFS (RMS of the first channel, floored at -60). */
export function measureLoudnessDb(buffer: AudioBuffer): number {
	const data = buffer.getChannelData(0);
	if (!data.length) return -60;
	// Sample huge buffers to keep the pass cheap.
	const step = Math.max(1, Math.floor(data.length / 200000));
	let sum = 0;
	let n = 0;
	for (let i = 0; i < data.length; i += step) {
		const v = data[i];
		sum += v * v;
		n++;
	}
	const rms = Math.sqrt(sum / Math.max(1, n));
	if (!(rms > 0)) return -60;
	return +Math.max(-60, 20 * Math.log10(rms)).toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

let sources: AudioBufferSourceNode[] = [];
let anchorCtx = 0;
let anchorOffset = 0;

function connectGain(c: AudioContext): GainNode {
	const gain = c.createGain();
	gain.connect(c.destination);
	return gain;
}

/** Schedule every clip of the timeline. `from` is the timeline offset to start at. */
export function startPlayback(clips: ScheduledClip[], from: number): void {
	const c = ensureContext();
	stopPlayback();

	anchorCtx = c.currentTime;
	anchorOffset = from;
	const origin = c.currentTime - from;

	for (const clip of clips) {
		const clipEnd = clip.start + clip.duration;
		if (clipEnd <= from + 0.001) continue;

		const when = origin + clip.start;
		const startAt = Math.max(when, c.currentTime);
		const offset = startAt - when;
		// Looped layers (ambience) repeat for the whole clip length — only
		// one-shots are capped at their buffer length.
		const playable = (clip.loop ? clip.duration : Math.min(clip.buffer.duration, clip.duration)) - offset;
		if (playable <= 0.01) continue;

		const src = c.createBufferSource();
		src.buffer = clip.buffer;
		if (clip.loop) {
			src.loop = true;
		}
		const gain = connectGain(c);
		src.connect(gain);

		const baseVol = typeof clip.gain === 'number' ? clip.gain : 1;
		const fi = Math.min(clip.fadeIn, playable / 2);
		const fo = Math.min(clip.fadeOut, playable / 2);
		const endTime = startAt + playable;
		const g = gain.gain;

		g.setValueAtTime(fi > 0 ? (Math.min(1, offset / fi) * baseVol) : baseVol, startAt);
		if (fi > offset) g.linearRampToValueAtTime(baseVol, when + fi);
		if (fo > 0) {
			const fadeStart = Math.max(startAt, when + fi, endTime - fo);
			if (fadeStart < endTime) {
				g.setValueAtTime(baseVol, fadeStart);
				g.linearRampToValueAtTime(0, endTime);
			}
		}

		if (clip.loop) {
			const loopOffset = offset % clip.buffer.duration;
			src.start(startAt, loopOffset, playable);
		} else {
			src.start(startAt, offset, playable);
		}
		sources.push(src);
	}
}

export function stopPlayback(): void {
	for (const s of sources) {
		try {
			s.stop();
		} catch {
			/* already stopped */
		}
	}
	sources = [];
}

/** Seconds elapsed since `startPlayback(from)` was called. */
export function elapsed(): number {
	if (!ctx) return anchorOffset;
	return ctx.currentTime - anchorCtx + anchorOffset;
}

/**
 * Render the whole timeline mix offline (stereo) — same scheduling, fades and
 * per-layer gains as live playback, but into a buffer for MP3/WAV export.
 * Always starts at 0 (the full Hörspiel, not the playhead position).
 */
export async function renderOfflineMixdown(
	clips: ScheduledClip[],
	totalSeconds: number,
	sampleRate = 44100
): Promise<AudioBuffer> {
	const seconds = Math.max(1, totalSeconds);
	const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
	for (const clip of clips) {
		const dur = clip.loop ? clip.duration : Math.min(clip.buffer.duration, clip.duration);
		if (dur <= 0.01 || clip.start >= seconds) continue;
		const length = Math.min(dur, seconds - clip.start);
		if (length <= 0.01) continue;

		const src = ctx.createBufferSource();
		src.buffer = clip.buffer;
		src.loop = !!clip.loop;
		const gain = ctx.createGain();
		gain.connect(ctx.destination);
		src.connect(gain);

		const baseVol = typeof clip.gain === 'number' ? clip.gain : 1;
		const fi = Math.min(clip.fadeIn, length / 2);
		const fo = Math.min(clip.fadeOut, length / 2);
		const g = gain.gain;
		g.setValueAtTime(fi > 0 ? 0 : baseVol, clip.start);
		if (fi > 0) g.linearRampToValueAtTime(baseVol, clip.start + fi);
		if (fo > 0) {
			const fadeStart = Math.max(clip.start + fi, clip.start + length - fo);
			g.setValueAtTime(baseVol, fadeStart);
			g.linearRampToValueAtTime(0, clip.start + length);
		}
		src.start(clip.start);
		src.stop(clip.start + length);
	}
	return await ctx.startRendering();
}

/* ------------------------------------------------------------------ */
/* Single-clip preview (independent of the timeline transport)         */
/* ------------------------------------------------------------------ */

let previewSources: AudioBufferSourceNode[] = [];

function trackPreview(src: AudioBufferSourceNode): void {
	previewSources.push(src);
	src.onended = () => {
		previewSources = previewSources.filter((s) => s !== src);
	};
}

export function previewBuffer(
	buffer: AudioBuffer,
	fadeIn = 0,
	fadeOut = 0,
	opts: { loop?: boolean } = {}
): void {
	const c = ensureContext();
	stopPreview();

	const src = c.createBufferSource();
	src.buffer = buffer;
	src.loop = !!opts.loop;
	const gain = connectGain(c);
	src.connect(gain);
	const dur = buffer.duration;
	const fi = Math.min(fadeIn, dur / 2);
	// A looping preview has no end, so only the fade-in applies.
	const fo = opts.loop ? 0 : Math.min(fadeOut, dur / 2);
	const t0 = c.currentTime;
	const g = gain.gain;
	g.setValueAtTime(fi > 0 ? 0 : 1, t0);
	if (fi > 0) g.linearRampToValueAtTime(1, t0 + fi);
	if (fo > 0) {
		const fadeStart = Math.max(t0 + fi, t0 + dur - fo);
		g.setValueAtTime(1, fadeStart);
		g.linearRampToValueAtTime(0, t0 + dur);
	}
	src.start();
	trackPreview(src);
}

/**
 * Live-mix several looped layers at their gains (ambience preview without a
 * rendered mixdown). Always loops — the caller stops it after the clip length
 * for one-shots, or lets it run forever in loop mode.
 */
export function previewLayers(layers: { buffer: AudioBuffer; gain: number }[]): void {
	const c = ensureContext();
	stopPreview();

	for (const layer of layers) {
		if (layer.gain <= 0.001) continue;
		const src = c.createBufferSource();
		src.buffer = layer.buffer;
		src.loop = true;
		const gain = c.createGain();
		gain.gain.value = Math.max(0, Math.min(1, layer.gain));
		src.connect(gain);
		gain.connect(c.destination);
		src.start();
		trackPreview(src);
	}
}

export function stopPreview(): void {
	const all = previewSources;
	previewSources = [];
	for (const s of all) {
		try {
			s.stop();
		} catch {
			/* already stopped */
		}
	}
}