/**
 * Fish Audio inline directives — [emotion:x], [pause:x], [emphasis], [speed:x] …
 * These are the heart of the editor: they are parsed, highlighted and estimated here.
 */

export const EMOTIONS = [
	'happy',
	'sad',
	'angry',
	'calm',
	'whisper',
	'excited',
	'fearful',
	'surprised',
	'sarcastic',
	'tender',
	'dramatic'
];

export type TagKind = 'emotion' | 'pause' | 'emphasis' | 'speed' | 'other';

export function tagKind(content: string): TagKind {
	const c = content.toLowerCase();
	if (c.includes('pause')) return 'pause';
	if (c.includes('emphasis') || c.includes('stress')) return 'emphasis';
	if (c.includes('speed')) return 'speed';
	if (c.includes('emotion')) return 'emotion';
	return 'other';
}

export function countTags(text: string): number {
	return (text.match(/\[[^\]]+\]/g) || []).length;
}

/** Seconds of speech for a piece of text, pauses included. */
export function estimateDuration(text: string): number {
	text = text || '';
	let pauseSecs = 0;
	const matches = text.matchAll(/\[pause:?\s*([\d.]+)s?\]/gi);
	for (const m of matches) pauseSecs += parseFloat(m[1] || '0');
	const stripped = text.replace(/\[[^\]]*\]/g, '').trim();
	const speech = stripped.length / 13;
	return Math.max(0.6, Math.round((speech + pauseSecs) * 10) / 10);
}

function escapeHtml(s: string): string {
	// SSR-safe (no document on the server)
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Renders text with Fish Audio directives as highlighted chips.
 * Pauses = amber, emotions = violet, emphasis = cyan, speed = emerald.
 */
export function renderTagged(text: string, truncate?: number): string {
	let t = text || '';
	if (truncate && t.length > truncate) t = t.slice(0, truncate) + '…';
	const esc = escapeHtml(t);
	return esc.replace(/\[([^\]]+)\]/g, (_m, p1: string) => {
		const kind = tagKind(p1);
		const cls =
			kind === 'pause'
				? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
				: kind === 'emphasis'
					? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
					: kind === 'speed'
						? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
						: 'bg-violet-500/15 text-violet-300 border-violet-500/30';
		const icon =
			kind === 'pause'
				? 'pause_circle'
				: kind === 'emphasis'
					? 'priority_high'
					: kind === 'speed'
						? 'speed'
						: 'theater_comedy';
		return `<span class="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${cls}">
			<span class="material-symbols-rounded text-[11px]">${icon}</span>${p1}</span>`;
	});
}

/**
 * Convert the editor's directive syntax into the cue syntax Fish Audio accepts.
 *
 * The editor uses explicit `[emotion:whisper]` / `[pause:0.5]` for UI clarity and
 * highlighting, but the S2 models read plain bracketed cues as natural-language
 * hints: `[whisper]`, `[emphasis]`, `[pause]`. Numeric pause lengths and per-tag
 * speed are not part of the cue vocabulary, so they collapse to `[pause]` / are
 * dropped rather than being read aloud verbatim.
 */
export function toFishText(text: string): string {
	return (text || '')
		.replace(/\[emotion:\s*([^\]]+)\]/gi, (_m, p1: string) => `[${p1.trim()}]`)
		.replace(/\[pause:?\s*[\d.]+s?\]/gi, '[pause]')
		.replace(/\[(?:speed):\s*[\d.]+s?\]/gi, '')
		.replace(/\[stress\]/gi, '[emphasis]')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

export function tagChipLabel(kind: TagKind): string {
	switch (kind) {
		case 'pause':
			return '[pause:0.5]';
		case 'emphasis':
			return '[emphasis]';
		case 'speed':
			return '[speed:1.2]';
		case 'emotion':
			return '[emotion:calm]';
		default:
			return '[tag]';
	}
}
