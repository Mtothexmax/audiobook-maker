import { base } from '$app/paths';

/**
 * MP3 encoding via the vendor lamejs browser build (lamejs 1.2.1, vendored at
 * static/lame.min.js).
 *
 * NOTE: the `lamejs` npm entry cannot be bundled — its sources rely on
 * sloppy-mode globals/CJS circulars that break bundlers with
 * `MPEGMode is not defined`. It is therefore loaded as a classic script,
 * which is exactly how the vendor ships it (see their example.html).
 */

interface LameJsGlobal {
	Mp3Encoder: new (
		channels: number,
		sampleRate: number,
		kbps: number
	) => {
		encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
		flush(): Int8Array;
	};
}

let lamePromise: Promise<LameJsGlobal> | null = null;

function loadLame(): Promise<LameJsGlobal> {
	const w = window as unknown as { lamejs?: LameJsGlobal };
	if (w.lamejs?.Mp3Encoder) return Promise.resolve(w.lamejs);
	if (!lamePromise) {
		lamePromise = new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = `${base}/lame.min.js`;
			s.onload = () => {
				const g = (window as unknown as { lamejs?: LameJsGlobal }).lamejs;
				if (g?.Mp3Encoder) resolve(g);
				else reject(new Error('MP3 encoder failed to initialize'));
			};
			s.onerror = () => reject(new Error('MP3 encoder failed to load'));
			document.head.appendChild(s);
		});
	}
	return lamePromise;
}

/** Encode an AudioBuffer as an MP3 blob (CBR, default 128 kbps). */
export async function encodeMp3(buffer: AudioBuffer, kbps = 128): Promise<Blob> {
	const { Mp3Encoder } = await loadLame();
	const channels = Math.min(2, buffer.numberOfChannels);
	const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);
	const left = buffer.getChannelData(0);
	const right = channels > 1 ? buffer.getChannelData(1) : left;

	const toInt16 = (f: number): number => {
		const s = Math.max(-1, Math.min(1, f));
		return s < 0 ? s * 0x8000 : s * 0x7fff;
	};

	const out: Int8Array[] = [];
	const block = 1152;
	for (let i = 0; i < left.length; i += block) {
		const n = Math.min(block, left.length - i);
		const l = new Int16Array(n);
		const r = new Int16Array(n);
		for (let j = 0; j < n; j++) {
			l[j] = toInt16(left[i + j]);
			r[j] = toInt16(right[i + j]);
		}
		const data = channels > 1 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
		if (data.length) out.push(data);
	}
	const end = encoder.flush();
	if (end.length) out.push(end);
	return new Blob(out as BlobPart[], { type: 'audio/mpeg' });
}
