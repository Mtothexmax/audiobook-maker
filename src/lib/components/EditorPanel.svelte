<script lang="ts">
	import { tick, onDestroy } from 'svelte';
	import {
		ui,
		project,
		charById,
		clipById,
		trackOfClip,
		regenerateClip,
		renderAmbienceClip,
		exportClipMp3,
		invalidateRender,
		clipHasAudio,
		clipEffects,
		EFFECT_TYPES,
		nextId,
		toast,
		importSoundFile,
		resolveSoundBuffer,
		VOICE_PRESETS
	} from '$lib/project.svelte';
	import type { EffectParam } from '$lib/types';
	import { EMOTIONS, emotionIcon } from '$lib/tags';
	import {
		getBuffer,
		previewBuffer,
		previewLayers,
		loadAudioBuffer,
		stopPreview,
		resumeContext
	} from '$lib/audio';
	import { AUDIO_CATALOG } from '$lib/project.svelte';
	import Knob from './Knob.svelte';
	import Avatar from './Avatar.svelte';

	let ta = $state<HTMLTextAreaElement | undefined>(undefined);
	let previewing = $state(false);
	let loopPreview = $state(false);
	let previewTimer: ReturnType<typeof setTimeout> | null = null;

	const clip = $derived(clipById(ui.editingClipId));
	const character = $derived(clip && clip.type === 'dialogue' ? charById(clip.characterId) : undefined);
	const trackName = $derived(clip ? (trackOfClip(clip.id)?.name ?? '') : '');

	const playable = $derived(clip ? clipHasAudio(clip.id) : false);
	const hasAudibleAmbience = $derived(
		clip && clip.type === 'ambience'
			? (clip.layers || []).some((l) => l.enabled && l.volume > 0.01)
			: true
	);

	function stopLocalPreview() {
		stopPreview();
		previewing = false;
		if (previewTimer) {
			clearTimeout(previewTimer);
			previewTimer = null;
		}
	}

	function startPreviewTimer(seconds: number) {
		previewing = true;
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = null;
		// In loop mode the preview runs forever until Stop; otherwise stop the
		// button state after one pass.
		if (!loopPreview) {
			previewTimer = setTimeout(() => {
				previewing = false;
				previewTimer = null;
			}, seconds * 1000 + 120);
		}
	}

	function preview() {
		const c = clip;
		if (!c || (c.type !== 'dialogue' && c.type !== 'ambience' && c.type !== 'sound')) return;
		// Play button doubles as Stop while a preview is running.
		if (previewing) {
			stopLocalPreview();
			return;
		}
		void resumeContext().then(async () => {
			if (c.type === 'sound') {
				const buffer = await resolveSoundBuffer(c);
				if (!buffer) {
					toast('Load an MP3 first');
					return;
				}
				previewBuffer(buffer, c.fadeIn, c.fadeOut, { loop: loopPreview });
				startPreviewTimer(Math.min(buffer.duration, c.duration));
				return;
			}
			if (c.type === 'dialogue') {
				const buffer = getBuffer(c.id);
				if (!buffer) return;
				previewBuffer(buffer, c.fadeIn, c.fadeOut, { loop: loopPreview });
				startPreviewTimer(buffer.duration);
			} else {
				const mixed = getBuffer(c.id);
				if (mixed) {
					previewBuffer(mixed, c.fadeIn, c.fadeOut, { loop: loopPreview });
					startPreviewTimer(mixed.duration);
				} else {
					// No mixdown yet — live-mix the enabled layers, no waveform needed.
					const active = (c.layers || []).filter((l) => l.enabled && l.volume > 0.01);
					if (!active.length) {
						toast('Enable at least one layer first');
						return;
					}
					try {
						const parts = [];
						for (const l of active) {
							parts.push({ buffer: await loadAudioBuffer(l.file), gain: l.volume });
						}
						previewLayers(parts);
						startPreviewTimer(c.duration);
					} catch {
						toast('Could not load ambience audio');
					}
				}
			}
		});
	}

	function toggleLoop() {
		const wasPlaying = previewing;
		loopPreview = !loopPreview;
		// Restart an in-flight preview so the new mode applies immediately.
		if (wasPlaying) {
			stopLocalPreview();
			preview();
		}
	}

	// Stop any running preview when moving to another clip.
	$effect(() => {
		void ui.editingClipId;
		stopPreview();
		previewing = false;
		loopPreview = false;
		if (previewTimer) {
			clearTimeout(previewTimer);
			previewTimer = null;
		}
	});

	function onTextInput(e: Event) {
		if (!clip || clip.type !== 'dialogue') return;
		const next = (e.target as HTMLTextAreaElement).value;
		if (clipHasAudio(clip.id)) invalidateRender(clip.id);
		clip.text = next;
	}

	/* Plain script editor: raw [bracket] tags stay as text — no highlight
	   backdrop, so cursor, selection and scrolling behave natively. */
	// The textarea element is reused across clips — reset scroll on switch.
	const editingId = $derived(ui.editingClipId);
	$effect(() => {
		void editingId;
		if (ta) ta.scrollTop = 0;
	});

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

	function addAmbienceLayer(item: { id: string; name: string; icon: string; file: string }) {
		if (!clip || clip.type !== 'ambience') return;
		if (!clip.layers) clip.layers = [];
		clip.layers = [...clip.layers, { id: item.id, name: item.name, icon: item.icon, file: item.file, volume: 0.5, enabled: true }];
	}

	function removeAmbienceLayer(layerId: string) {
		if (!clip || clip.type !== 'ambience' || !clip.layers) return;
		clip.layers = clip.layers.filter((l) => l.id !== layerId);
	}

	function onRegenerate() {
		if (!clip) return;
		if (clip.type === 'ambience') void renderAmbienceClip(clip.id);
		else void regenerateClip(clip.id);
	}

	let exportingClip = $state(false);

	/** Render this clip when needed, bounce it to MP3 and download the file. */
	async function onExportClip() {
		const c = clip;
		if (!c || exportingClip || c.rendering) return;
		exportingClip = true;
		try {
			const result = await exportClipMp3(c.id);
			if (!result) return;
			const base =
				c.type === 'dialogue' ? (character?.name ?? 'dialogue') : c.type === 'ambience' ? 'Ambience_Mix' : c.name;
			const safe =
				(base || 'clip')
					.replace(/\s+/g, '_')
					.replace(/[^\w\-]+/g, '')
					.slice(0, 60) || 'clip';
			const url = URL.createObjectURL(result.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${safe}.mp3`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			toast(`Clip exported as MP3 (${result.duration.toFixed(1)}s)`);
		} catch {
			toast('Clip export failed');
		} finally {
			exportingClip = false;
		}
	}

	/* Sound MP3 upload (bytes → audio cache, JSON keeps the reference) */

	let soundFileInput = $state<HTMLInputElement | undefined>(undefined);
	let importingSound = $state(false);

	function uploadDisplayName(file: string): string {
		if (!file.startsWith('upload:')) return file;
		const dash = file.indexOf('-');
		return dash >= 0 ? file.slice(dash + 1) : file;
	}

	async function onSoundFilePicked(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !clip || clip.type !== 'sound') return;
		importingSound = true;
		try {
			await importSoundFile(clip.id, file);
		} finally {
			importingSound = false;
		}
	}

	/* ------------------------------------------------------------------ */
	/* FX rack (FL-style): list left, selected effect's knobs right        */
	/* ------------------------------------------------------------------ */

	let selectedFxId = $state<string | null>(null);
	let showAddMenu = $state(false);

	const fxList = $derived(clip ? clipEffects(clip) : []);
	const selectedFx = $derived(
		fxList.find((f) => f.id === selectedFxId) ?? fxList[0] ?? null
	);

	function fxIcon(name: string): string {
		return EFFECT_TYPES.find((t) => t.name === name)?.icon ?? 'tune';
	}

	function addFx(typeName: string) {
		if (!clip) return;
		const def = EFFECT_TYPES.find((t) => t.name === typeName);
		if (!def) return;
		const fx = { id: nextId('fx'), name: def.name, on: true, params: def.makeParams() };
		clipEffects(clip).push(fx);
		selectedFxId = fx.id;
		showAddMenu = false;
	}

	function removeSelectedFx() {
		if (!clip) return;
		const list = clipEffects(clip);
		const target = list.find((f) => f.id === selectedFxId) ?? list[0];
		if (!target) return;
		const idx = list.findIndex((f) => f.id === target.id);
		if (idx >= 0) list.splice(idx, 1);
		if (selectedFxId === target.id) selectedFxId = null;
	}

	/** '180 ms' / '35%' / '-18 dB' / '+2.5 st' / '30% L' / 'C' */
	function formatParam(p: EffectParam): string {
		if (p.name === 'Pan') {
			const v = Math.round(p.value);
			if (v === 0) return 'C';
			return `${Math.abs(v)}% ${v < 0 ? 'L' : 'R'}`;
		}
		const v = p.step >= 1 ? Math.round(p.value) : +p.value.toFixed(1);
		const sign = p.min < 0 && p.value > 0 ? '+' : '';
		return `${sign}${v}${p.unit}`;
	}
</script>

{#if clip}
<section class="flex h-[330px] shrink-0 flex-col border-t border-white/10 bg-[#151a24]">
		<div class="flex min-h-0 flex-1">
			<!-- main -->
			<div class="scrollbar min-w-0 flex-1 overflow-y-auto p-4">
				<!-- header -->
				<div class="mb-3 flex items-center gap-3">
					{#if clip.type === 'dialogue'}
						{#if character?.face}
							<Avatar face={character.face} size={36} />
						{:else}
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-700 text-sm font-bold text-gray-300"
								>{character?.name.trim().charAt(0).toUpperCase() || '?'}</div
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
									: clip.file
										? 'Loaded sound'
										: 'No audio — load an MP3'}
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

					{#if clip.type === 'dialogue' || clip.type === 'ambience' || clip.type === 'sound'}
						{@const canPreview =
							playable ||
							(clip.type === 'ambience' && hasAudibleAmbience) ||
							(clip.type === 'sound' && !!clip.file)}
						{#if canPreview}
							<button
								class="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition
									{previewing
										? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
										: 'border-white/10 bg-[#202635] text-gray-200 hover:bg-[#262b36]'}"
								onclick={preview}
								title={previewing
									? 'Stop preview'
									: clip.type === 'ambience' && !playable
										? 'Preview the live layer mix (no waveform needed)'
										: 'Preview'}
							>
								<span class="material-symbols-rounded text-sm">
									{previewing ? 'stop' : 'play_arrow'}
								</span>
								{previewing ? 'Stop' : 'Play'}
							</button>
							<button
								class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border transition
									{loopPreview
										? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
										: 'border-white/10 bg-[#202635] text-gray-500 hover:text-gray-300'}"
								onclick={toggleLoop}
								title={loopPreview ? 'Loop on — preview repeats forever' : 'Loop off — click to repeat forever'}
							>
								<span class="material-symbols-rounded text-sm">repeat</span>
							</button>
						{:else}
							<div class="ml-auto"></div>
						{/if}

						{#if clip.type === 'dialogue' || clip.type === 'ambience'}
							<button
								class="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
								onclick={onRegenerate}
								disabled={clip.rendering || !hasAudibleAmbience}
								title={clip.type === 'ambience' ? 'Mix enabled layers into a waveform of the visible clip length' : 'Render with Fish Audio'}
							>
								<span class="material-symbols-rounded text-sm {clip.rendering ? 'animate-spin' : ''}">
									{clip.rendering ? 'progress_activity' : 'autorenew'}
								</span>
								{clip.rendering
									? 'Rendering...'
									: clip.type === 'ambience'
										? 'Render waveform'
										: clip.rendered
											? 'Regenerate'
											: 'Render audio'}
							</button>
						{/if}
						<button
							class="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#202635] px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-[#262b36] disabled:opacity-50"
							onclick={onExportClip}
							disabled={exportingClip || clip.rendering}
							title="Render this clip if needed and download it as an MP3 file"
						>
							<span class="material-symbols-rounded text-sm {exportingClip ? 'animate-spin' : ''}">
								{exportingClip ? 'progress_activity' : 'download'}
							</span>
							{exportingClip ? 'Exporting...' : 'Export MP3'}
						</button>
					{/if}

					<button
						class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/5 hover:text-white"
						title="Close editor"
						onclick={() => {
							ui.editingClipId = null;
							ui.fxClipId = null;
						}}
					>
						<span class="material-symbols-rounded text-base">close</span>
					</button>
				</div>

				{#if ui.fxClipId === clip.id}
					<!-- FX rack (opened via the clip's fx badge, any clip type) -->
					<div class="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-500">
						<span class="material-symbols-rounded text-[13px] text-violet-400">tune</span>
						<span class="truncate">
							Effects — {clip.type === 'dialogue' ? (character?.name ?? 'Unassigned') : clip.type === 'ambience' ? 'Ambience Mix' : clip.name}
						</span>
					</div>
					<div class="flex h-full min-h-0 gap-4 pb-1">
						<!-- effect list (left): only this list scrolls, never the drawer -->
						<div class="flex min-h-0 w-44 shrink-0 flex-col">
							<div class="scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
								{#each fxList as fx (fx.id)}
								{@const active = selectedFx?.id === fx.id}
								<div
									class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition
										{active ? 'border-violet-500/60 bg-violet-500/10' : 'border-transparent hover:border-white/10 hover:bg-white/5'}"
									onclick={() => {
										selectedFxId = fx.id;
										showAddMenu = false;
									}}
									title="Select to edit parameters"
								>
									<span class="material-symbols-rounded text-[14px] {fx.on ? 'text-cyan-300' : 'text-gray-600'}">{fxIcon(fx.name)}</span>
									<span class="min-w-0 flex-1 truncate text-[11px] font-medium {fx.on ? 'text-gray-200' : 'text-gray-500'}">{fx.name}</span>
									<button
										class="flex h-5 w-5 shrink-0 items-center justify-center rounded transition
											{fx.on ? 'text-emerald-400 hover:bg-white/10' : 'text-gray-600 hover:bg-white/10 hover:text-gray-400'}"
										title={fx.on ? 'Bypass effect' : 'Enable effect'}
										onclick={(e) => {
											e.stopPropagation();
											fx.on = !fx.on;
										}}
									>
										<span class="material-symbols-rounded text-[13px]">power_settings_new</span>
									</button>
								</div>
							{/each}
								{#if fxList.length === 0}
									<div class="rounded-lg border border-dashed border-white/15 px-2 py-3 text-center text-[10px] text-gray-500">
										No effects — press + to add one.
									</div>
								{/if}
							</div>
							<!-- + / − toolbar (left, below the list) -->
							<div class="mt-1.5 flex shrink-0 gap-1.5">
								<span class="relative flex-1">
									<button
										class="flex h-6 w-full items-center justify-center gap-1 rounded-md bg-violet-600 text-xs font-semibold text-white transition hover:bg-violet-500"
										title="Add effect"
										onclick={() => (showAddMenu = !showAddMenu)}
									>
										<span class="material-symbols-rounded text-sm">add</span>
									</button>
									{#if showAddMenu}
										<div
											class="absolute bottom-full left-0 z-40 mb-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-white/10 bg-[#202635] shadow-2xl"
										>
											{#each EFFECT_TYPES as t (t.name)}
												<button
													class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 transition hover:bg-white/5"
													onclick={() => addFx(t.name)}
												>
													<span class="material-symbols-rounded text-[15px] text-cyan-300">{t.icon}</span>
													<span class="flex-1">{t.name}</span>
													<span class="material-symbols-rounded text-[13px] text-gray-600">add</span>
												</button>
											{/each}
										</div>
									{/if}
								</span>
								<button
									class="flex h-6 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#202635] text-gray-300 transition hover:bg-white/10 disabled:opacity-40"
									title="Remove selected effect"
									disabled={!selectedFx}
									onclick={removeSelectedFx}
								>
									<span class="material-symbols-rounded text-sm">remove</span>
								</button>
							</div>
						</div>
						<!-- selected effect parameters -->
						<div class="min-w-0 flex-1">
							{#if selectedFx}
								<div class="mb-1 text-[10px] uppercase tracking-widest text-gray-500">
									{selectedFx.name} parameters
								</div>
								<div class="flex flex-wrap gap-3">
									{#each selectedFx.params as p (p.name)}
										<Knob
											bind:value={p.value}
											label={p.name}
											size={52}
											min={p.min}
											max={p.max}
											step={p.step}
											display={formatParam(p)}
											clickToggle={false}
										/>
									{/each}
								</div>
							{:else}
								<div class="flex h-full items-center text-[11px] italic text-gray-600">
									Select an effect on the left to tune its parameters.
								</div>
							{/if}
						</div>
					</div>
				{:else if clip.type === 'dialogue'}
					<!-- script + fish audio controls -->
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
						Script + Fish Audio controls
					</div>
					<!-- plain script editor: raw [bracket] tags stay as text -->
					<textarea
						bind:this={ta}
						value={clip.text}
						oninput={onTextInput}
						rows={6}
						spellcheck={false}
						class="scrollbar block h-36 w-full resize-none overflow-y-auto rounded-xl border border-white/10 bg-[#0e131b] p-3 font-mono text-sm leading-6 text-gray-200 caret-violet-300 outline-none selection:bg-violet-500/40 placeholder:text-gray-600 focus:border-violet-500/60"
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
								<span class="material-symbols-rounded text-xs">{emotionIcon(em)}</span>{em}
							</button>
						{/each}
					</div>
				{:else if clip.type === 'ambience'}
					<!-- AMBIENCE MIXER -->
					<!-- All layers (including muted) -->
					{#if clip.layers && clip.layers.length > 0}
						<div class="mb-3 flex flex-wrap gap-2">
							{#each clip.layers as layer (layer.id)}
								{@const catalogItem = AUDIO_CATALOG.ambience.find((item) => item.id === layer.id)}
								{#if catalogItem}
									<div class="group relative flex flex-col items-center gap-0.5 transition {layer.volume === 0 ? 'opacity-40' : ''}">
										<button
											class="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-white/10 bg-[#202635] text-gray-500 opacity-0 transition hover:border-red-500/40 hover:text-red-400 group-hover:opacity-100"
											onclick={() => removeAmbienceLayer(layer.id)}
											title="Remove {catalogItem.name} from the mix"
										>
											<span class="material-symbols-rounded text-[11px]">close</span>
										</button>
										<Knob
											bind:value={layer.volume}
											icon={catalogItem.icon}
											size={40}
											min={0}
											max={1}
											step={0.01}
										/>
										<button
											class="text-center text-[8px] font-medium text-gray-300 max-w-[50px] truncate cursor-pointer hover:text-white"
											onclick={() => layer.volume = layer.volume === 0 ? 0.5 : 0}
											title="Click to {layer.volume === 0 ? 'unmute' : 'mute'}"
										>{catalogItem.name}</button>
									</div>
								{/if}
							{/each}
						</div>
					{:else}
						<div class="mb-3 text-center text-[11px] text-gray-500 py-2">No layers — add from below</div>
					{/if}

					<!-- Available ambient layers to add -->
					<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Add layer</div>
					<div class="flex flex-wrap gap-1.5">
						{#each AUDIO_CATALOG.ambience as item (item.id)}
							{@const alreadyAdded = clip.layers?.some((l) => l.id === item.id)}
							<button
								class="flex items-center gap-1 rounded border px-2 py-1 text-[10px] transition
									{alreadyAdded ? 'border-white/5 bg-white/5 text-gray-600 cursor-default' : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/15 hover:border-cyan-500/50'}"
								onclick={() => !alreadyAdded && addAmbienceLayer(item)}
								disabled={alreadyAdded}
								title={alreadyAdded ? 'Already added' : 'Add to mix'}
							>
								<span class="material-symbols-rounded text-[13px]">{item.icon}</span>
								{item.name}
							</button>
						{/each}
					</div>
				{:else}
					<!-- sound clip: rename + load MP3 from the computer -->
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
						<div>
							<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500"
								>Length</span
							>
							<div class="rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-200">
								{clip.duration.toFixed(1)}s
								<span class="text-gray-600">· trim on the timeline</span>
							</div>
						</div>
					</div>
					<div class="mt-3 flex max-w-md items-center gap-2">
						<input
							type="file"
							accept="audio/*,.mp3,.wav,.ogg,.m4a"
							class="hidden"
							bind:this={soundFileInput}
							onchange={onSoundFilePicked}
						/>
						<button
							class="flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
							disabled={importingSound}
							onclick={() => soundFileInput?.click()}
						>
							<span class="material-symbols-rounded text-sm {importingSound ? 'animate-spin' : ''}">
								{importingSound ? 'progress_activity' : 'upload'}
							</span>
							{importingSound ? 'Loading...' : clip.file ? 'Replace MP3' : 'Load MP3'}
						</button>
						<div class="min-w-0 flex-1 truncate text-[11px] text-gray-500" title={clip.file ?? ''}>
							{clip.file
								? (playable ? `Loaded · ${uploadDisplayName(clip.file)}` : `Cached · ${uploadDisplayName(clip.file)} — re-resolves on play`)
								: 'No audio yet — load an MP3 from your computer'}
						</div>
					</div>
					<div class="mt-2 max-w-md rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[10.5px] leading-relaxed text-gray-500">
						<span class="material-symbols-rounded mr-1 align-middle text-[13px] text-cyan-400/70">save</span>
						Audio bytes live in the audio cache (IndexedDB) — the project JSON keeps only the file reference.
					</div>
				{/if}
			</div>
	</div>

</section>
{/if}