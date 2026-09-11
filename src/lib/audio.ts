/**
 * Web Audio playback engine + Fish Audio synthesis client.
 *
 * Rendered clips are kept as decoded AudioBuffers in memory, keyed by clip id.
 * Playback schedules one BufferSource per clip on a shared AudioContext, with
 * gain envelopes for fade in/out and an optional trimmed length.
 */

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

/** Fetch and decode an audio file from an asset URL with in-memory caching. */
export async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
	const cached = urlBuffers.get(url);
	if (cached) return cached;

	const p = (async () => {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to load audio asset: ${res.statusText}`);
		const arrayBuffer = await res.arrayBuffer();
		const c = ensureContext();
		return await new Promise<AudioBuffer>((resolve, reject) => {
			const promise = c.decodeAudioData(arrayBuffer, resolve, reject);
			if (promise && typeof promise.then === 'function') promise.then(resolve, reject);
		});
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
		const playable = Math.min(clip.buffer.duration, clip.duration) - offset;
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

/* ------------------------------------------------------------------ */
/* Single-clip preview (independent of the timeline transport)         */
/* ------------------------------------------------------------------ */

let previewSrc: AudioBufferSourceNode | null = null;

export function previewBuffer(buffer: AudioBuffer, fadeIn = 0, fadeOut = 0): void {
	const c = ensureContext();
	stopPreview();

	const src = c.createBufferSource();
	src.buffer = buffer;
	const gain = connectGain(c);
	src.connect(gain);
	const dur = buffer.duration;
	const fi = Math.min(fadeIn, dur / 2);
	const fo = Math.min(fadeOut, dur / 2);
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
	previewSrc = src;
}

export function stopPreview(): void {
	if (previewSrc) {
		try {
			previewSrc.stop();
		} catch {
			/* already stopped */
		}
		previewSrc = null;
	}
}
