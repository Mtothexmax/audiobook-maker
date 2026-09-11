<script lang="ts">
	import {
		project,
		ui,
		togglePlay,
		resetPlayhead,
		seek,
		totalDuration,
		SOUND_PRESETS,
		SOUND_CATEGORIES,
		addCharacter,
		addSoundClip,
		addCategoryClip,
		trackOfClip,
		settings,
		renderAllClips,
		stopPlay,
		clipHasAudio,
		type SoundCategory
	} from '$lib/project.svelte';
	import { onDestroy } from 'svelte';
	import Avatar from './Avatar.svelte';
	import Lane from './Lane.svelte';
	import EditorPanel from './EditorPanel.svelte';

	onDestroy(() => stopPlay());

	let renderingAll = $state(false);
	async function renderAll() {
		if (renderingAll) return;
		renderingAll = true;
		try {
			await renderAllClips();
		} finally {
			renderingAll = false;
		}
	}

	function unrenderedCount(): number {
		let n = 0;
		for (const t of project.tracks) {
			for (const c of t.clips) {
				if (c.type === 'dialogue' && c.text.trim() && !clipHasAudio(c.id)) n++;
			}
		}
		return n;
	}
	const missingAudio = $derived(unrenderedCount());

	/* ------------------------------------------------------------------ */
	/* helpers                                                             */
	/* ------------------------------------------------------------------ */

	function fmtClock(s: number): string {
		const m = Math.floor(s / 60);
		const sec = (s % 60).toFixed(1).padStart(4, '0');
		return `${String(m).padStart(2, '0')}:${sec}`;
	}

	function fmtTotal(s: number): string {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	function rulerStep(zoom: number): number {
		if (zoom >= 180) return 1;
		if (zoom >= 90) return 2;
		if (zoom >= 45) return 5;
		if (zoom >= 22) return 10;
		return 30;
	}

	function renderedStats(): { done: number; total: number; pct: number } {
		let total = 0;
		let done = 0;
		for (const t of project.tracks) {
			for (const c of t.clips) {
				total++;
				if (c.type === 'sound' || clipHasAudio(c.id)) done++;
			}
		}
		return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
	}

	function onSeek(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		seek(Math.max(0, (e.clientX - rect.left) / ui.zoom));
	}

	/* drag a sound preset (HTML5 DnD) onto any lane */
	function onPresetDragStart(e: DragEvent, name: string) {
		const preset = SOUND_PRESETS.find((p) => p.name === name);
		if (!preset || !e.dataTransfer) return;
		e.dataTransfer.setData('application/x-sound-preset', JSON.stringify(preset));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
	}

	/* click a preset: add it to the lane of the selected clip (or first lane) */
	function addPresetClick(presetName: string) {
		const preset = SOUND_PRESETS.find((p) => p.name === presetName);
		if (!preset) return;
		const targetTrack =
			(ui.selectedClipId ? trackOfClip(ui.selectedClipId) : undefined) ?? project.tracks[0];
		if (!targetTrack) return;
		addSoundClip(targetTrack.id, preset);
	}

	const GUTTER = 160;

	const total = $derived(totalDuration());
	const step = $derived(rulerStep(ui.zoom));
	function ticks(): number[] {
		const arr: number[] = [];
		for (let t = 0; t <= total; t += step) arr.push(t);
		return arr;
	}
	const stats = $derived(renderedStats());
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- transport + zoom toolbar -->
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-[#151a24] px-4">
		<button
			class="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white transition hover:bg-violet-500"
			title={ui.playing ? 'Pause' : 'Play'}
			onclick={togglePlay}
		>
			<span class="material-symbols-rounded text-base">{ui.playing ? 'pause' : 'play_arrow'}</span>
		</button>
		<button
			class="flex h-8 w-8 items-center justify-center rounded text-gray-400 transition hover:bg-white/5 hover:text-white"
			title="Back to start"
			onclick={resetPlayhead}
		>
			<span class="material-symbols-rounded text-base">skip_previous</span>
		</button>
		<span class="w-32 font-mono text-xs tabular-nums text-gray-400">{fmtClock(ui.playhead)} / {fmtTotal(total)}</span>
		<div class="h-1 max-w-md flex-1 overflow-hidden rounded bg-white/10">
			<div
				class="h-full rounded bg-violet-500 transition-[width] duration-100"
				style="width: {total > 0 ? ((ui.playhead / total) * 100).toFixed(1) : 0}%"
			></div>
		</div>

		<div class="ml-auto flex items-center gap-1">
			<button
				class="mr-1 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
				title="Render every unrendered dialogue clip with Fish Audio"
				onclick={renderAll}
				disabled={renderingAll || missingAudio === 0}
			>
				<span class="material-symbols-rounded text-sm {renderingAll ? 'animate-spin' : ''}">
					{renderingAll ? 'progress_activity' : 'graphic_eq'}
				</span>
				{renderingAll ? 'Rendering...' : `Render all${missingAudio ? ` (${missingAudio})` : ''}`}
			</button>
			<button
				class="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-white/5 hover:text-white"
				title="Zoom out"
				onclick={() => (ui.zoom = Math.max(20, Math.round(ui.zoom / 1.25)))}
			>
				<span class="material-symbols-rounded text-base">zoom_out</span>
			</button>
			<input
				type="range"
				min="20"
				max="240"
				step="10"
				bind:value={ui.zoom}
				class="w-28 cursor-pointer"
				title="Timeline zoom (px per second)"
			/>
			<button
				class="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-white/5 hover:text-white"
				title="Zoom in"
				onclick={() => (ui.zoom = Math.min(240, Math.round(ui.zoom * 1.25)))}
			>
				<span class="material-symbols-rounded text-base">zoom_in</span>
			</button>
			<span class="w-12 text-center text-xs tabular-nums text-gray-500">{ui.zoom}%</span>
		</div>
	</div>

	<div class="flex min-h-0 flex-1">
		<!-- sidebar: cast + sound library -->
		<aside class="flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#111620]">
			<div class="flex items-center justify-between border-b border-white/10 p-3">
				<div>
					<div class="text-[10px] uppercase tracking-widest text-gray-500">Cast</div>
					<div class="text-sm font-semibold text-gray-100">Characters</div>
				</div>
				<button
					class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-gray-300 transition hover:bg-white/10"
					title="Add character"
					onclick={() => {
						const c = addCharacter();
						ui.selectedCharacterId = c.id;
					}}
				>
					<span class="material-symbols-rounded text-base">add</span>
				</button>
			</div>

			<div class="scrollbar max-h-[38%] overflow-y-auto p-2">
				{#each project.characters as c (c.id)}
					<button
						class="mb-1 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition
							{ui.selectedCharacterId === c.id
								? 'border-violet-500/60 bg-violet-500/10'
								: 'border-transparent hover:border-white/10 hover:bg-white/5'}"
						onclick={() => (ui.selectedCharacterId = c.id)}
					>
						<Avatar face={c.face} size={32} />
						<div class="min-w-0 flex-1">
							<div class="truncate text-xs font-medium text-gray-200">{c.name}</div>
							<div class="truncate font-mono text-[10px] text-gray-500">{c.voiceId}</div>
						</div>
						<span
							class="rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[9px] text-gray-500"
							>{c.emotion}</span
						>
					</button>
				{/each}
				{#if project.characters.length === 0}
					<div class="px-2 py-6 text-center text-[11px] text-gray-600">
						No characters yet — add one or define them in the Characters tab.
					</div>
				{/if}
			</div>

			<!-- sound library: draggable onto ANY lane -->
			<div class="border-y border-white/10 p-3">
				<div class="mb-1 text-[10px] uppercase tracking-widest text-gray-500">Sound library</div>
				<div class="mb-2 text-[10px] leading-snug text-gray-600">
					Drag onto <b class="text-gray-500">any lane</b> — lanes are not type-specific.
				</div>
				<div class="scrollbar max-h-40 space-y-0.5 overflow-y-auto pr-1">
					{#each SOUND_PRESETS as p (p.name)}
						<div
							class="group flex cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-cyan-400/30 hover:bg-cyan-500/5 active:cursor-grabbing"
							draggable="true"
							ondragstart={(e) => onPresetDragStart(e, p.name)}
							onclick={() => addPresetClick(p.name)}
							title="Drag onto a lane, or click to add to the selected lane"
						>
							<span class="material-symbols-rounded text-[15px] text-cyan-300">{p.icon}</span>
							<span class="min-w-0 flex-1 truncate text-[11px] text-gray-300">{p.name}</span>
							<span class="text-[10px] text-gray-600">{p.duration}s</span>
							<span class="material-symbols-rounded text-sm text-gray-600 opacity-0 transition group-hover:opacity-100">drag_indicator</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- footer status -->
			<div class="mt-auto space-y-1.5 border-t border-white/10 p-3 text-[11px] text-gray-500">
				<div class="flex justify-between">
					<span>Voice engine</span>
					<b class="text-gray-300">Fish Audio</b>
				</div>
				<div class="flex justify-between">
					<span>Rendered</span>
					<b class="text-emerald-400">{stats.pct}%</b>
				</div>
				<button
					class="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 transition hover:bg-white/5"
					onclick={() => (ui.settingsOpen = true)}
					title="Open settings"
				>
					<span class="flex items-center gap-1.5">
						<span class="material-symbols-rounded text-[14px]">key</span>
						API key
					</span>
					<span
						class="flex items-center gap-1 {settings.fishAudioApiKey ? 'text-emerald-400' : 'text-amber-400/90'}"
					>
						<span class="material-symbols-rounded text-[12px]">
							{settings.fishAudioApiKey ? 'check_circle' : 'error_outline'}
						</span>
						{settings.fishAudioApiKey ? 'configured' : 'not set'}
					</span>
				</button>
			</div>
		</aside>

		<!-- timeline -->
		<div class="scrollbar min-w-0 flex-1 overflow-auto bg-[#0d121a]">
			<div class="relative" style="width: {GUTTER + total * ui.zoom}px">
				<!-- ruler -->
				<div class="sticky top-0 z-30 flex w-full">
					<div
						class="sticky left-0 z-40 flex w-40 shrink-0 items-center border-b border-r border-white/10 bg-[#111620] px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
					>
						Timeline
					</div>
					<div
						class="relative h-7 flex-1 cursor-text border-b border-white/10 bg-[#111620]"
						onclick={onSeek}
					>
						{#each ticks() as t (t)}
							<div class="absolute bottom-0 top-0" style="left: {t * ui.zoom}px">
								<span class="absolute left-1 top-1 select-none font-mono text-[9px] text-gray-500">{fmtTotal(t)}</span>
								<div class="absolute bottom-0 h-2 w-px bg-white/15"></div>
							</div>
						{/each}
					</div>
				</div>

				<!-- lanes -->
				{#each project.tracks as track (track.id)}
					<Lane {track} zoom={ui.zoom} gridStep={step * ui.zoom} />
				{/each}

				<!-- playhead -->
				<div
					class="pointer-events-none absolute z-20 w-0.5 bg-violet-400"
					style="left: {GUTTER + ui.playhead * ui.zoom}px; top: 28px; bottom: 0"
				>
					<div class="absolute -left-[5px] -top-[3px] h-2.5 w-2.5 rounded-full bg-violet-400"></div>
				</div>
			</div>
		</div>
	</div>

	<!-- clip editor (bottom, ChatGPT-style) -->
	<EditorPanel />

	<!-- hint bar -->
	<div
		class="flex h-8 shrink-0 items-center gap-4 border-t border-white/10 bg-[#111620] px-4 text-[10.5px] text-gray-500"
	>
		<span class="flex items-center gap-1">
			<span class="material-symbols-rounded text-[13px] text-amber-400">drag_handle</span>
			Drag bottom handles to cut
		</span>
		<span class="flex items-center gap-1">
			<span class="material-symbols-rounded text-[13px] text-cyan-400">radio_button_unchecked</span>
			Drag top handles to fade
		</span>
		<span class="flex items-center gap-1">
			<span class="material-symbols-rounded text-[13px]">touch_app</span>
			Double-click a clip to edit
		</span>
		<span class="ml-auto hidden items-center gap-1 sm:flex">
			<span class="material-symbols-rounded text-[13px] text-violet-400">sell</span>
			[emotion:x] / [pause:x] directives are sent to Fish Audio
		</span>
	</div>
</div>
