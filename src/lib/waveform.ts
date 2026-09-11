/** Deterministic pseudo-random waveform generation (stable per clip id/seed). */

function hashStr(s: string): number {
	let h = 1779033703;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function mulberry32(a: number): () => number {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function genWaveform(seed: string, n = 64): number[] {
	const rnd = mulberry32(hashStr(seed));
	const arr: number[] = [];
	let v = 0.4 + rnd() * 0.2;
	for (let i = 0; i < n; i++) {
		v += (rnd() - 0.5) * 0.5;
		v = Math.max(0.08, Math.min(1, v));
		arr.push(+v.toFixed(3));
	}
	return arr;
}

/** Downsample/upsample a waveform to `count` bars. */
export function sampleWaveform(src: number[], count: number): number[] {
	if (!src.length) return [];
	if (count <= 1) return [src[0]];
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		out.push(src[Math.floor((i / (count - 1)) * (src.length - 1))] ?? src[src.length - 1]);
	}
	return out;
}
