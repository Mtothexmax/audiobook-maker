import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

/**
 * Server-side proxy for the Fish Audio text-to-speech API.
 *
 * The API key stays on the server: it is read from the FISH_AUDIO_API_KEY
 * environment variable, or — for convenience during local prototyping —
 * accepted from the request body (which the browser stores in localStorage).
 * Returns raw audio bytes.
 */

const TTS_URL = 'https://api.fish.audio/v1/tts';
const DEFAULT_MODEL = 's2.1-pro-free';

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: {
		text?: string;
		referenceId?: string;
		model?: string;
		apiKey?: string;
		speed?: number;
		format?: 'mp3' | 'wav';
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const text = (body.text ?? '').trim();
	if (!text) return json({ error: 'No text to synthesize' }, { status: 400 });

	const apiKey = env.FISH_AUDIO_API_KEY || body.apiKey || '';
	if (!apiKey) {
		return json(
			{ error: 'No Fish Audio API key — add one in Settings or set FISH_AUDIO_API_KEY' },
			{ status: 400 }
		);
	}

	const model = body.model || DEFAULT_MODEL;
	const payload: Record<string, unknown> = {
		text,
		format: body.format ?? 'mp3',
		mp3_bitrate: 128,
		normalize: true,
		latency: 'normal'
	};
	// Empty reference_id would make Fish fall back inconsistently, so omit it.
	if (body.referenceId) payload.reference_id = body.referenceId;
	if (typeof body.speed === 'number' && body.speed > 0) {
		payload.prosody = { speed: body.speed };
	}

	let upstream: Response;
	try {
		upstream = await fetch(TTS_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				model
			},
			body: JSON.stringify(payload)
		});
	} catch (e) {
		return json(
			{ error: `Could not reach Fish Audio: ${e instanceof Error ? e.message : 'network error'}` },
			{ status: 502 }
		);
	}

	if (!upstream.ok) {
		let message = `Fish Audio error ${upstream.status}`;
		try {
			const err = await upstream.json();
			if (err?.message) message = err.message;
			else if (err?.reason) message = err.reason;
		} catch {
			/* non-JSON error body */
		}
		return json({ error: message }, { status: upstream.status });
	}

	const audio = await upstream.arrayBuffer();
	return new Response(audio, {
		headers: {
			'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
			'Cache-Control': 'no-store'
		}
	});
};
