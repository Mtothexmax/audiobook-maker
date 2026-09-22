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
		clearClipSelection,
		setSelectedClipIds,
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
		window.removeEventListener('mousemove', onMarqueeMove);
		window.removeEventListener('mouseup', onMarqueeUp);
		stopMarqueeAutoscroll();
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

	/* drag-to-pan the timeline (middle mouse button, or left-drag outside lane bodies) */
	let panning = $state(false);
	let suppressPanClick = false;
	const pan = { active: false, x: 0, y: 0, left: 0, top: 0, el: null as HTMLElement | null };

	function startPan(e: MouseEvent) {
		const el = e.currentTarget as HTMLElement;
		pan.active = true;
		pan.x = e.clientX;
		pan.y = e.clientY;
		pan.left = el.scrollLeft;
		pan.top = el.scrollTop;
		pan.el = el;
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

	/* ------------------------------------------------------------------ */
	/* rubber-band select: drag empty lane space to select every clip the  */
	/* rectangle touches — across all lanes. Shift/Ctrl/Cmd adds to the    */
	/* existing selection instead of replacing it.                         */
	/* ------------------------------------------------------------------ */

	const MARQUEE_THRESHOLD = 4;

	let scrollEl: HTMLElement | null = null;
	let contentEl: HTMLElement | null = null;
	const marquee = $state({ active: false, moved: false, x0: 0, y0: 0, x1: 0, y1: 0 });
	/** marquee corners in client coords (for hit-testing clip boxes) */
	let mqClient = { x0: 0, y0: 0, x1: 0, y1: 0 };
	let mqAdditive = false;
	/** selection before the drag started (kept when additive) */
	let mqBaseIds: string[] = [];
	let mqLastClient = { x: 0, y: 0 };
	let mqScrollTimer: ReturnType<typeof setInterval> | null = null;

	const marqueeBox = $derived({
		left: Math.min(marquee.x0, marquee.x1),
		top: Math.min(marquee.y0, marquee.y1),
		width: Math.abs(marquee.x1 - marquee.x0),
		height: Math.abs(marquee.y1 - marquee.y0)
	});

	function stopMarqueeAutoscroll() {
		if (mqScrollTimer) {
			clearInterval(mqScrollTimer);
			mqScrollTimer = null;
		}
	}

	function toContent(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!contentEl) return null;
		const r = contentEl.getBoundingClientRect();
		return { x: clientX - r.left, y: clientY - r.top };
	}

	function clampToContent(p: { x: number; y: number }): { x: number; y: number } {
		if (!contentEl) return p;
		const r = contentEl.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(p.x, r.width)),
			y: Math.max(0, Math.min(p.y, r.height))
		};
	}

	/** Every clip whose box intersects the marquee rectangle (any lane). */
	function marqueeHits(): string[] {
		const x0 = Math.min(mqClient.x0, mqClient.x1);
		const x1 = Math.max(mqClient.x0, mqClient.x1);
		const y0 = Math.min(mqClient.y0, mqClient.y1);
		const y1 = Math.max(mqClient.y0, mqClient.y1);
		const out: string[] = [];
		scrollEl?.querySelectorAll('[data-clip-id]').forEach((node) => {
			const el = node as HTMLElement;
			const id = el.dataset.clipId;
			if (!id) return;
			const r = el.getBoundingClientRect();
			if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0) out.push(id);
		});
		return out;
	}

	function updateMarqueeFromClient(clientX: number, clientY: number) {
		mqLastClient = { x: clientX, y: clientY };
		mqClient.x1 = clientX;
		mqClient.y1 = clientY;
		const p = toContent(clientX, clientY);
		if (p) {
			const c = clampToContent(p);
			marquee.x1 = c.x;
			marquee.y1 = c.y;
		}
		if (!marquee.moved && Math.hypot(clientX - mqClient.x0, clientY - mqClient.y0) > MARQUEE_THRESHOLD) {
			marquee.moved = true;
		}
		if (marquee.moved) {
			const hits = marqueeHits();
			setSelectedClipIds(mqAdditive ? [...mqBaseIds, ...hits] : hits);
		}
	}

	function startMarqueeAutoscroll() {
		stopMarqueeAutoscroll();
		if (!browser) return;
		mqScrollTimer = setInterval(() => {
			if (!marquee.active || !scrollEl) return;
			const r = scrollEl.getBoundingClientRect();
			const MARGIN = 28;
			const STEP = 18;
			let dx = 0;
			let dy = 0;
			if (mqLastClient.x < r.left + MARGIN) dx = -STEP;
			else if (mqLastClient.x > r.right - MARGIN) dx = STEP;
			if (mqLastClient.y < r.top + MARGIN) dy = -STEP;
			else if (mqLastClient.y > r.bottom - MARGIN) dy = STEP;
			if (dx || dy) {
				scrollEl.scrollLeft += dx;
				scrollEl.scrollTop += dy;
				updateMarqueeFromClient(mqLastClient.x, mqLastClient.y);
			}
		}, 40);
	}

	/**
	 * Start a rubber-band select. Returns false when the press belongs to
	 * someone else (clip drag, button, ruler seek, lane header, ...).
	 */
	function onMarqueeDown(e: MouseEvent): boolean {
		const t = e.target as HTMLElement;
		// Clips, controls and the ruler keep their own gestures.
		if (t.closest('[data-clip-id], button, input, select, textarea, a, [data-ruler]')) return false;
		// Only on lane bodies — the header gutter keeps its own behavior.
		if (!t.closest('[data-lane-id]')) return false;
		if (!browser) return false;
		e.preventDefault();
		mqAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
		mqBaseIds = mqAdditive ? [...ui.selectedClipIds] : [];
		// (Lane already cleared plain clicks on mousedown — harmless to repeat.)
		if (!mqAdditive) clearClipSelection();
		mqClient = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
		mqLastClient = { x: e.clientX, y: e.clientY };
		const p = toContent(e.clientX, e.clientY);
		const c = p ? clampToContent(p) : { x: 0, y: 0 };
		marquee.x0 = marquee.x1 = c.x;
		marquee.y0 = marquee.y1 = c.y;
		marquee.moved = false;
		marquee.active = true;
		window.addEventListener('mousemove', onMarqueeMove);
		window.addEventListener('mouseup', onMarqueeUp);
		startMarqueeAutoscroll();
		return true;
	}

	function onMarqueeMove(e: MouseEvent) {
		if (!marquee.active) return;
		e.preventDefault();
		updateMarqueeFromClient(e.clientX, e.clientY);
	}

	function onMarqueeUp() {
		window.removeEventListener('mousemove', onMarqueeMove);
		window.removeEventListener('mouseup', onMarqueeUp);
		stopMarqueeAutoscroll();
		marquee.active = false;
		marquee.moved = false;
	}

	/** Left = rubber-band on lanes (pan only outside lane bodies), middle = pan. */
	function onTimelineMouseDown(e: MouseEvent) {
		const t = e.target as HTMLElement;
		if (e.button === 1) {
			if (t.closest('[data-clip-id], button, input, select, textarea, a')) return;
			e.preventDefault();
			startPan(e);
			return;
		}
		if (e.button !== 0) return;
		if (onMarqueeDown(e)) return;
		// Left-drag outside lane bodies (e.g. the lane header gutter) still pans.
		if (t.closest('[data-clip-id], button, input, select, textarea, a, [data-ruler]')) return;
		e.preventDefault();
		startPan(e);
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
		const next = Math.max(5, Math.min(240, Math.round(ui.zoom * factor)));
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
		// Ctrl/Cmd+A selects all clips
		if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
			e.preventDefault();
			const ids: string[] = [];
			for (const t of project.tracks) {
				for (const c of t.clips) ids.push(c.id);
			}
			setSelectedClipIds(ids);
			return;
		}
		// Space to play from the time marker / pause at the time marker
		// (but not on key-repeat).
		if (e.code === 'Space' && !e.repeat) {
			e.preventDefault();
			void togglePlay();
		}
		// Delete/Backspace deletes the selected clip(s)
		if ((e.code === 'Delete' || e.code === 'Backspace') && ui.selectedClipId) {
			e.preventDefault();
			const ids = ui.selectedClipIds.length ? [...ui.selectedClipIds] : [ui.selectedClipId];
			for (const id of ids) deleteClip(id);
			ui.selectedClipId = null;
			ui.selectedClipIds = [];
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

	/* drag a character onto any lane to create a dialogue clip for that voice */
	function onCharacterDragStart(e: DragEvent, characterId: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('application/x-character-id', characterId);
		e.dataTransfer.effectAllowed = 'copy';
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
				onclick={() => (ui.zoom = Math.max(5, Math.round(ui.zoom / 1.25)))}
			>
				<span class="material-symbols-rounded text-base">zoom_out</span>
			</button>
			<input
				type="range"
				min="5"
				max="240"
				step="5"
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
			<div class="p-3 pb-1">
				<div class="text-[10px] uppercase tracking-widest text-gray-500">Characters</div>
				<div class="mt-0.5 text-[10px] text-gray-600">Drag a voice onto a lane for a new line</div>
			</div>

			<div class="scrollbar max-h-[38%] overflow-y-auto p-2">
				{#each project.characters as c (c.id)}
					<button
						class="mb-1 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition
						{ui.selectedCharacterId === c.id
							? 'border-violet-500/60 bg-violet-500/10'
							: 'border-transparent hover:border-white/10 hover:bg-white/5'}"
						onclick={() => (ui.selectedCharacterId = c.id)}
						draggable="true"
						ondragstart={(e) => onCharacterDragStart(e, c.id)}
						title="Click to select · drag onto a lane to create a dialogue clip"
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
			bind:this={scrollEl}
			class="scrollbar min-w-0 flex-1 overflow-auto bg-[#0d121a] {panning
				? 'cursor-grabbing select-none'
				: marquee.active
					? 'cursor-crosshair select-none'
					: ''}"
			onwheel={onWheel}
			onmousedown={onTimelineMouseDown}
			onclickcapture={onPanClickCapture}
		>
			<div bind:this={contentEl} class="relative" style="width: {GUTTER + total * ui.zoom}px">
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

				<!-- rubber-band selection rectangle -->
				{#if marquee.active && marquee.moved}
					<div
						class="pointer-events-none absolute z-10 border border-cyan-300/80 bg-cyan-400/15"
						style="left: {marqueeBox.left}px; top: {marqueeBox.top}px; width: {marqueeBox.width}px; height: {marqueeBox.height}px;"
					></div>
				{/if}

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