<script lang="ts">
	import {
		project,
		ui,
		togglePlay,
		resetPlayhead,
		seek,
		totalDuration,
		SOUND_CATEGORIES,
		addCharacter,
		renderAllClips,
		stopPlay,
		clipHasAudio,
		deleteClip,
		type SoundCategory
	} from '$lib/project.svelte';
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Avatar from './Avatar.svelte';
	import Lane from './Lane.svelte';
	import { addTrack } from '$lib/project.svelte';
	import EditorPanel from './EditorPanel.svelte';

	onDestroy(() => stopPlay());

	onDestroy(() => {
		// onDestroy also runs during SSR — never touch window there.
		if (!browser) return;
		window.removeEventListener('mousemove', onPanMove);
		window.removeEventListener('mouseup', onPanUp);
	});

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

	function onSeek(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		seek(Math.max(0, (e.clientX - rect.left) / ui.zoom));
	}

	/* drag-to-pan the timeline (grab empty space to scroll left/right) */
	let panning = $state(false);
	let suppressPanClick = false;
	const pan = { active: false, x: 0, y: 0, left: 0, top: 0, el: null as HTMLElement | null };

	function onPanDown(e: MouseEvent) {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement;
		// Clips, controls and the ruler keep their own gestures — pan everywhere else.
		if (t.closest('[data-clip-id], button, input, select, textarea, a, [data-ruler]')) return;
		const el = e.currentTarget as HTMLElement;
		pan.active = true;
		pan.x = e.clientX;
		pan.y = e.clientY;
		pan.left = el.scrollLeft;
		pan.top = el.scrollTop;
		pan.el = el;
		e.preventDefault();
		window.addEventListener('mousemove', onPanMove);
		window.addEventListener('mouseup', onPanUp);
	}

	function onPanMove(e: MouseEvent) {
		if (!pan.active || !pan.el) return;
		const dx = e.clientX - pan.x;
		const dy = e.clientY - pan.y;
		if (!panning && Math.hypot(dx, dy) > 4) panning = true;
		if (!panning) return;
		pan.el.scrollLeft = pan.left - dx;
		pan.el.scrollTop = pan.top - dy;
	}

	function onPanUp() {
		window.removeEventListener('mousemove', onPanMove);
		window.removeEventListener('mouseup', onPanUp);
		if (panning) suppressPanClick = true;
		pan.active = false;
		pan.el = null;
		panning = false;
	}

	/* Swallow the ruler seek click when a pan gesture just ended on it. */
	function onPanClickCapture(e: MouseEvent) {
		if (!suppressPanClick) return;
		suppressPanClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	/* mousewheel zoom (zoom at cursor; Shift+wheel keeps native horizontal scroll) */
	function onWheel(e: WheelEvent) {
		if (e.shiftKey) return;
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		const cursorX = e.clientX - rect.left;
		const timeAtCursor = Math.max(0, (cursorX + el.scrollLeft - GUTTER) / ui.zoom);
		const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
		const next = Math.max(20, Math.min(240, Math.round(ui.zoom * factor)));
		if (next === ui.zoom) return;
		ui.zoom = next;
		const targetLeft = Math.max(0, timeAtCursor * next + GUTTER - cursorX);
		requestAnimationFrame(() => {
			el.scrollLeft = targetLeft;
		});
	}

	/* keyboard shortcuts (window-level so they work regardless of focus) */
	function onKeyDown(e: KeyboardEvent) {
		if (ui.tab !== 'timeline') return;
		const tag = (e.target as HTMLElement)?.tagName ?? '';
		if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
		// Space to play from the time marker / pause at the time marker
		// (but not on key-repeat).
		if (e.code === 'Space' && !e.repeat) {
			e.preventDefault();
			void togglePlay();
		}
		// Delete/Backspace to delete selected clip
		if ((e.code === 'Delete' || e.code === 'Backspace') && ui.selectedClipId) {
			e.preventDefault();
			deleteClip(ui.selectedClipId);
			ui.selectedClipId = null;
			ui.editingClipId = null;
			ui.fxClipId = null;
		}
	}

	/* drag a category onto any lane (clicking does nothing — drag & drop only) */
	function onCategoryDragStart(e: DragEvent, category: SoundCategory) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('application/x-sound-category', JSON.stringify(category));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
	}

	const GUTTER = 32;

	const total = $derived(totalDuration());
	const step = $derived(rulerStep(ui.zoom));
	function ticks(): number[] {
		const arr: number[] = [];
		for (let t = 0; t <= total; t += step) arr.push(t);
		return arr;
	}
</script>

<svelte:window onkeydown={onKeyDown} />

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
				{renderingAll ? 'Rendering...' : `Render missing${missingAudio ? ` (${missingAudio})` : ''}`}
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
			<div class="p-3">
				<div class="text-[10px] uppercase tracking-widest text-gray-500">Characters</div>
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
						{#if c.face}
							<Avatar face={c.face} size={32} />
						{:else}
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-gray-500 ring-1 ring-white/10"
								>{c.name.trim().charAt(0).toUpperCase() || '?'}</span
							>
						{/if}
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

			<!-- sound library: 3 categories draggable onto ANY lane -->
			<div class="border-y border-white/10 p-3">
				<div class="text-[10px] uppercase tracking-widest text-gray-500">Sound library</div>
				<div class="scrollbar max-h-48 space-y-1.5 overflow-y-auto pr-1">
					{#each SOUND_CATEGORIES as cat (cat.id)}
						<div
							class="group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 transition hover:border-cyan-400/30 hover:bg-cyan-500/5 active:cursor-grabbing"
							draggable="true"
							ondragstart={(e) => onCategoryDragStart(e, cat.id)}
							title="Drag onto a lane to add"
						>
							<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/15 border border-cyan-500/30">
								<span class="material-symbols-rounded text-[16px] text-cyan-300">{cat.icon}</span>
							</div>
							<div class="min-w-0 flex-1">
								<div class="truncate text-[11px] font-semibold text-gray-200">{cat.name}</div>
								<div class="truncate text-[10px] text-gray-500">{cat.description}</div>
							</div>
							<span class="material-symbols-rounded text-sm text-gray-600 opacity-0 transition group-hover:opacity-100">drag_indicator</span>
						</div>
					{/each}
				</div>
			</div>
		</aside>

		<!-- timeline -->
		<div
			class="scrollbar min-w-0 flex-1 overflow-auto bg-[#0d121a] {panning ? 'cursor-grabbing select-none' : 'cursor-grab'}"
			onwheel={onWheel}
			onmousedown={onPanDown}
			onclickcapture={onPanClickCapture}
		>
			<div class="relative" style="width: {GUTTER + total * ui.zoom}px">
				<!-- ruler -->
				<div class="sticky top-0 z-30 flex w-full">
					<div
						class="sticky left-0 z-40 flex w-8 shrink-0 items-center justify-center border-b border-r border-white/10 bg-[#111620] px-1"
					>
						<button
							class="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-gray-400 transition hover:bg-white/20 hover:text-white"
							title="Add new lane"
							onclick={() => addTrack()}
						>
							<span class="material-symbols-rounded text-sm">add</span>
						</button>
					</div>
					<div
						class="relative h-7 flex-1 cursor-text border-b border-white/10 bg-[#111620]"
						data-ruler
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
</div>