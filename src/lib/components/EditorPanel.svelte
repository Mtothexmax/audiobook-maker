<script lang="ts">
	import { tick, onDestroy } from 'svelte';
	import {
		ui,
		project,
		charById,
		clipById,
		trackOfClip,
		regenerateClip,
		invalidateRender,
		deleteClip,
		duplicateClip,
		effectiveDuration,
		clipHasAudio,
		VOICE_PRESETS
	} from '$lib/project.svelte';
	import { EMOTIONS, estimateDuration, renderTagged, countTags } from '$lib/tags';
	import { getBuffer, previewBuffer, stopPreview, resumeContext } from '$lib/audio';
	import { AUDIO_CATALOG } from '$lib/project.svelte';
	import Knob from './Knob.svelte';
	import Avatar from './Avatar.svelte';

	let ta = $state<HTMLTextAreaElement | undefined>(undefined);
	let previewing = $state(false);
	let previewTimer: ReturnType<typeof setTimeout> | null = null;

	const clip = $derived(clipById(ui.editingClipId));
	const character = $derived(clip && clip.type === 'dialogue' ? charById(clip.characterId) : undefined);
	const trackName = $derived(clip ? (trackOfClip(clip.id)?.name ?? '') : '');
	const effDur = $derived(clip ? effectiveDuration(clip) : 0);
	const playable = $derived(clip ? clipHasAudio(clip.id) : false);

	function preview() {
		if (!clip || clip.type !== 'dialogue' && clip.type !== 'ambience') return;
		const buffer = getBuffer(clip.id);
		if (!buffer) return;
		void resumeContext().then(() => {
			previewBuffer(buffer, clip.fadeIn, clip.fadeOut);
			previewing = true;
			if (previewTimer) clearTimeout(previewTimer);
			previewTimer = setTimeout(() => (previewing = false), buffer.duration * 1000 + 120);
		});
	}

	function onTextInput(e: Event) {
		if (!clip || clip.type !== 'dialogue') return;
		const next = (e.target as HTMLTextAreaElement).value;
		if (clipHasAudio(clip.id)) invalidateRender(clip.id);
		clip.text = next;
	}

	onDestroy(() => {
		stopPreview();
		if (previewTimer) clearTimeout(previewTimer);
	});

	function insertTag(raw: string) {
		if (!clip || clip.type !== 'dialogue') return;
		invalidateRender(clip.id);
		const el = ta;
		if (!el) {
			clip.text += raw;
			return;
		}
		const start = el.selectionStart ?? clip.text.length;
		const end = el.selectionEnd ?? clip.text.length;
		clip.text = clip.text.slice(0, start) + raw + clip.text.slice(end);
		tick().then(() => {
			el.focus();
			const pos = start + raw.length;
			el.setSelectionRange(pos, pos);
		});
	}

	function clampFade(v: number, max: number): number {
		if (Number.isNaN(v)) return 0;
		return Math.max(0, Math.min(max, v));
	}

	// Ambience Mixer helpers
	function updateLayerVolume(layer: { id: string; volume: number; enabled: boolean }, value: number) {
		layer.volume = value;
		layer.enabled = value > 0.05;
	}

	function toggleLayerEnabled(layer: { enabled: boolean; volume: number }) {
		if (layer.enabled) {
			layer.enabled = false;
			layer.volume = 0;
		} else {
			layer.enabled = true;
			layer.volume = 0.5;
		}
	}

	function getAmbienceLayers(clip: { layers: Array<{ id: string; name: string; icon: string; file: string; volume: number; enabled: boolean }> }) {
		return clip.layers || [];
	}

	function previewAmbienceMix() {
		if (!clip || clip.type !== 'ambience') return;
		// For preview, we'd need to mix multiple layers - for now just preview first enabled layer
		const activeLayer = (clip.layers || []).find(l => l.enabled && l.volume > 0.05);
		if (!activeLayer) return;
		void resumeContext().then(async () => {
			const { loadAudioBuffer } = await import('$lib/audio');
			try {
				const buffer = await loadAudioBuffer(activeLayer.file);
				previewBuffer(buffer, clip.fadeIn, clip.fadeOut);
				previewing = true;
				if (previewTimer) clearTimeout(previewTimer);
				previewTimer = setTimeout(() => (previewing = false), buffer.duration * 1000 + 120);
			} catch (e) {
				console.warn('Could not preview ambience layer:', e);
			}
		});
	}
</script>

<section class="flex h-[330px] shrink-0 flex-col border-t border-white/10 bg-[#151a24]">
	{#if clip}
		<div class="flex min-h-0 flex-1">
			<!-- main -->
			<div class="scrollbar min-w-0 flex-1 overflow-y-auto p-4">
				<!-- header -->
				<div class="mb-3 flex items-center gap-3">
					{#if clip.type === 'dialogue'}
						{#if character}
							<Avatar face={character.face} size={36} />
						{:else}
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-700 text-sm font-bold text-gray-300"
								>?</div
							>
						{/if}
					{:else if clip.type === 'ambience'}
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/15"
						>
							<span class="material-symbols-rounded text-cyan-300">{clip.icon}</span>
						</div>
					{:else}
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/15"
						>
							<span class="material-symbols-rounded text-cyan-300">graphic_eq</span>
						</div>
					{/if}

					<div class="min-w-0">
						<div class="truncate text-sm font-semibold text-gray-100">
							{clip.type === 'dialogue' ? (character?.name ?? 'Unassigned') : clip.type === 'ambience' ? 'Ambience Mix' : clip.name}
						</div>
						<div class="text-[11px] text-gray-500">
							Lane “{trackName}” · {clip.type === 'dialogue'
								? playable
									? 'Rendered'
									: clip.rendered
										? 'Stale — re-render'
										: 'Not rendered'
								: clip.type === 'ambience'
									? 'Mixable multi-loop ambience'
									: 'Library sound'}
						</div>
					</div>

					{#if clip.type === 'dialogue'}
						<select
							class="ml-2 rounded border border-white/10 bg-[#202635] px-2 py-1 text-xs text-gray-200 outline-none focus:border-violet-500/60"
							value={clip.characterId}
							onchange={(e) => {
								invalidateRender(clip.id);
								clip.characterId = (e.target as HTMLSelectElement).value;
							}}
							title="Change the speaking character"
						>
							<option value="" disabled>— assign character —</option>
							{#each project.characters as c}
								{@const p = VOICE_PRESETS.find((vp) => vp.voiceId === c.voiceId)}
								<option value={c.id}>{p?.flag ?? '🌐'} {c.name}</option>
							{/each}
						</select>
					{/if}

					{#if clip.type === 'dialogue' || clip.type === 'ambience'}
						{#if playable}
							<button
								class="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#202635] px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-[#262b36]"
								onclick={preview}
								title="Preview the rendered audio"
							>
								<span class="material-symbols-rounded text-sm">
									{previewing ? 'graphic_eq' : 'play_arrow'}
								</span>
								{previewing ? 'Playing' : 'Play'}
							</button>
						{:else}
							<div class="ml-auto"></div>
						{/if}

						<button
							class="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
							onclick={() => regenerateClip(clip.id)}
							disabled={clip.rendering}
						>
							<span class="material-symbols-rounded text-sm {clip.rendering ? 'animate-spin' : ''}">
								{clip.rendering ? 'progress_activity' : 'autorenew'}
							</span>
							{clip.rendering ? 'Rendering...' : clip.rendered ? 'Regenerate' : 'Render audio'}
						</button>
					{/if}

					<button
						class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/5 hover:text-white"
						title="Close editor"
						onclick={() => (ui.editingClipId = null)}
					>
						<span class="material-symbols-rounded text-base">close</span>
					</button>
				</div>

				{#if clip.type === 'dialogue'}
					<!-- script + fish audio controls -->
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
						Script + Fish Audio controls
					</div>
					<textarea
						bind:this={ta}
						value={clip.text}
						oninput={onTextInput}
						rows={6}
						class="scrollbar h-36 w-full resize-none rounded-xl border border-white/10 bg-[#0e131b] p-3 font-mono text-sm leading-6 text-gray-200 outline-none focus:border-violet-500/60"
						placeholder="Write the line... use [emotion:x], [pause:x], [emphasis], [speed:x]"
					></textarea>

					{#if clip.renderError}
						<div
							class="mt-2 flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-snug text-red-300"
						>
							<span class="material-symbols-rounded text-sm">error</span>
							<span>{clip.renderError}</span>
						</div>
					{/if}

					<div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
						<button
							class="flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 font-medium text-amber-300 transition hover:bg-amber-500/20"
							onclick={() => insertTag('[pause:0.5]')}
						>
							<span class="material-symbols-rounded text-xs">pause_circle</span>pause
						</button>
						<button
							class="flex items-center gap-1 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-medium text-cyan-300 transition hover:bg-cyan-500/20"
							onclick={() => insertTag('[emphasis]')}
						>
							<span class="material-symbols-rounded text-xs">priority_high</span>emphasis
						</button>
						<button
							class="flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-300 transition hover:bg-emerald-500/20"
							onclick={() => insertTag('[speed:1.2]')}
						>
							<span class="material-symbols-rounded text-xs">speed</span>speed
						</button>
						{#each EMOTIONS as em}
							<button
								class="flex items-center gap-1 rounded border border-violet-500/20 bg-violet-500/10 px-2 py-1 font-medium text-violet-300 transition hover:bg-violet-500/20"
								onclick={() => insertTag(`[emotion:${em}]`)}
							>
								<span class="material-symbols-rounded text-xs">theater_comedy</span>{em}
							</button>
						{/each}
					</div>

					<!-- highlighted preview -->
					<div class="mt-3">
						<div class="mb-1 text-[10px] uppercase tracking-widest text-gray-500">
							Preview — Fish Audio directives highlighted
							{#if countTags(clip.text) > 0}
								<span class="ml-1 normal-case text-violet-400">({countTags(clip.text)} directives)</span>
							{/if}
						</div>
						<div
							class="min-h-[42px] rounded-lg border border-white/10 bg-[#0e131b] p-2.5 text-xs leading-relaxed text-gray-300"
						>
							{#if clip.text.trim()}
								{@html renderTagged(clip.text)}
							{:else}
								<span class="italic text-gray-600"
									>Nothing written yet — insert a pause, emotion or emphasis above.</span
								>
							{/if}
						</div>
					</div>
				{:else if clip.type === 'ambience'}
					<!-- AMBIENCE MIXER -->
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
						Ambience Mixer — drag knobs up/down, click to toggle 50%/0%
					</div>

					<!-- Available ambient layers -->
					<div class="mb-4">
						<div class="mb-2 text-[11px] text-cyan-300 font-medium">Ambient Layers ({clip.layers?.filter(l => l.enabled).length ?? 0} active of {clip.layers?.length ?? 0})</div>
						<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
							{#each AUDIO_CATALOG.ambience as item (item.id)}
								{#if clip.layers?.some(l => l.id === item.id)}
									<!-- Already in mix - show knob -->
									{#const layer = clip.layers.find(l => l.id === item.id)!}
										<div class="flex flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-[#1e2432] p-3 transition hover:border-cyan-500/30">
											<span class="material-symbols-rounded text-[22px] text-cyan-300">{item.icon}</span>
											<span class="text-center text-[10px] font-medium text-gray-200 max-w-[70px] truncate">{item.name}</span>
											<Knob
												bind:value={layer.volume}
												label={item.name}
												icon={item.icon}
												size={56}
												min={0}
												max={1}
												step={0.01}
											/>
										</div>
									{/const}
								{:else}
									<!-- Not in mix - show add button -->
									<button
										class="flex flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-[#0e131b] p-3 text-center text-[10px] text-gray-400 transition hover:border-cyan-500/30 hover:bg-cyan-500/5 hover:text-cyan-300"
										onclick={() => {
											if (!clip.layers) clip.layers = [];
											clip.layers = [...clip.layers, {
												id: item.id,
												name: item.name,
												icon: item.icon,
												file: item.file,
												volume: 0.5,
												enabled: true
											}];
										}}
										title="Add to mix"
									>
										<span class="material-symbols-rounded text-[22px] text-gray-500">{item.icon}</span>
										<span class="text-center text-[10px] max-w-[70px] truncate">{item.name}</span>
										<span class="material-symbols-rounded text-[16px] text-cyan-400">add_circle</span>
									</button>
								{/if}
							{/each}
						</div>
					</div>

					<!-- Mix controls -->
					<div class="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3">
						<div class="grid grid-cols-3 gap-3">
							<label class="block">
								<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">Duration (s)</span>
								<input
									type="number"
									min="1"
									step="1"
									class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500/60"
									value={clip.duration}
									oninput={(e) => (clip.duration = Math.max(1, +(e.target as HTMLInputElement).value))}
								/>
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">Fade in (s)</span>
								<input
									type="number"
									min="0"
									step="0.1"
									class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500/60"
									value={clip.fadeIn}
									oninput={(e) => (clip.fadeIn = clampFade(+(e.target as HTMLInputElement).value, effDur / 2))}
								/>
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">Fade out (s)</span>
								<input
									type="number"
									min="0"
									step="0.1"
									class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500/60"
									value={clip.fadeOut}
									oninput={(e) => (clip.fadeOut = clampFade(+(e.target as HTMLInputElement).value, effDur / 2))}
								/>
							</label>
						</div>
						<div class="mt-3 flex items-center gap-2">
							<button
								class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#202635] px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-[#262b36]"
								onclick={previewAmbienceMix}
								disabled={previewing}
							>
								<span class="material-symbols-rounded text-sm">{previewing ? 'graphic_eq' : 'play_arrow'}</span>
								{previewing ? 'Previewing...' : 'Preview Mix'}
							</button>
							<button
								class="ml-auto flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
								onclick={() => {
									if (clip.layers) {
										for (const layer of clip.layers) {
											layer.enabled = false;
											layer.volume = 0;
										}
									}
								}}
							>
								<span class="material-symbols-rounded text-sm">volume_off</span>Mute All
							</button>
						</div>
					</div>

					<div class="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-cyan-200/90">
						<span class="material-symbols-rounded mr-1 align-middle text-[14px]">tune</span>
						Click a knob to toggle 50% / 0% (mute). Drag up/down for fine control. Enable multiple layers to build a rich ambience bed.
					</div>
				{:else}
					<!-- sound clip -->
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Sound clip</div>
					<div class="grid max-w-md grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500"
								>Sound name</span
							>
							<input
								class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500/60"
								value={clip.name}
								oninput={(e) => (clip.name = (e.target as HTMLInputElement).value)}
							/>
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500"
								>Duration (s)</span
							>
							<input
								type="number"
								min="0.2"
								step="0.1"
								class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-500/60"
								value={clip.duration}
								oninput={(e) => (clip.duration = Math.max(0.2, +(e.target as HTMLInputElement).value))}
							/>
						</label>
					</div>
					<div class="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-[11px] leading-relaxed text-cyan-200/90">
						<span class="material-symbols-rounded mr-1 align-middle text-[14px]">music_note</span>
						Library sound — rendered waveform, no Fish Audio synthesis needed.
					</div>
				{/if}
			</div>

			<!-- right column -->
			<div class="scrollbar w-72 shrink-0 overflow-y-auto border-l border-white/10 p-4">
				{#if clip.type === 'dialogue'}
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Audio Effects</div>
					{#each clip.effects as fx (fx.name)}
						<label class="flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition hover:bg-white/5">
							<input type="checkbox" bind:checked={fx.on} class="accent-violet-500" />
							<span class="flex-1 text-xs text-gray-300">{fx.name}</span>
							<span class="text-[10px] text-gray-500">{fx.value}</span>
						</label>
					{/each}
					<div class="my-3 border-t border-white/10"></div>
				{/if}

				<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Clip timing</div>
				<div class="text-xs text-gray-400">
					{#if clip.type === 'dialogue' && !clip.rendered}
						Estimated length <b class="text-amber-400">~{estimateDuration(clip.text).toFixed(1)}s</b>
						<span class="text-gray-600">(from text length)</span>
					{:else}
						Length <b class="text-gray-200">{effDur.toFixed(1)}s</b>
						{#if clip.type === 'dialogue' && clip.rendered}
							<span class="text-gray-600">· rendered</span>
						{/if}
					{/if}
				</div>

				<div class="mt-4">
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Fades</div>
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1 block text-[10px] text-gray-500">Fade in (s)</span>
							<input
								type="number"
								min="0"
								step="0.1"
								class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-500/60"
								value={clip.fadeIn}
								oninput={(e) => (clip.fadeIn = clampFade(+(e.target as HTMLInputElement).value, effDur / 2))}
							/>
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] text-gray-500">Fade out (s)</span>
							<input
								type="number"
								min="0"
								step="0.1"
								class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-500/60"
								value={clip.fadeOut}
								oninput={(e) => (clip.fadeOut = clampFade(+(e.target as HTMLInputElement).value, effDur / 2))}
							/>
						</label>
					</div>
					<p class="mt-1.5 text-[10px] leading-snug text-gray-500">
						Tip: drag the cyan circles on a clip's top corners to fade, the amber tabs on the bottom
						corners to cut/trim.
					</p>
				</div>
			</div>
		</div>

		<!-- footer actions -->
		<div class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-4 py-2.5">
			<button
				class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#202635] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-[#262b36]"
				onclick={() => duplicateClip(clip.id)}
			>
				<span class="material-symbols-rounded text-sm">content_copy</span>Duplicate
			</button>
			<button
				class="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
				onclick={() => deleteClip(clip.id)}
			>
				<span class="material-symbols-rounded text-sm">delete</span>Delete
			</button>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center gap-2 text-sm text-gray-600">
			<span class="material-symbols-rounded text-lg">touch_app</span>
			Double-click a timeline clip to edit its text, emotion, pauses, voice, and effects.
		</div>
	{/if}
</section>