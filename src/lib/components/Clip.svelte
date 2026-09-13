<script lang="ts" module>
	/** Consumed by the next clip click after a real drag — keeps a
	 *  multi-selection intact instead of collapsing it (the click that
	 *  ends a drag must not single-select). Shared across instances so it
	 *  also survives the remount of cross-lane drags. */
	let suppressClickSelect = false;
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Clip, AmbienceClip } from '$lib/types';
	import {
		ui,
		project,
		charById,
		clipById,
		effectiveDuration,
		moveClipToTrack,
		trackOfClip,
		snap,
		clipHasAudio,
		clipEffects,
		deleteClip,
		duplicateClip,
		isClipSelected,
		selectClipExclusive,
		toggleClipSelected,
		previewStarts,
		refreshPlaybackSoon,
		VOICE_PRESETS
	} from '$lib/project.svelte';
	import { renderTagged, countTags } from '$lib/tags';
	import { sampleWaveform } from '$lib/waveform';
	import Avatar from './Avatar.svelte';

	type DragMode = 'move' | 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out';
	const MIN_DURATION = 0.3;

	let { clip, zoom, muted }: { clip: Clip; zoom: number; muted: boolean } = $props();

	const effDur = $derived(effectiveDuration(clip));
	const wPx = $derived(Math.max(28, effDur * zoom));
	const isSelected = $derived(isClipSelected(clip.id));
	/** Live pause-preview position (Insert-pause dialog) — falls back to the real start. */
	const shownStart = $derived(previewStarts[clip.id] ?? clip.start);
	const previewShifted = $derived(
		previewStarts[clip.id] !== undefined && Math.abs(previewStarts[clip.id] - clip.start) > 0.001
	);
	const character = $derived(clip.type === 'dialogue' ? charById(clip.characterId) : undefined);
	/**
	 * Unrendered dialogue clips have unknown length → cannot be trimmed/faded yet.
	 * Ambience clips always carry a numeric duration, so they stay trimmable
	 * even before a waveform is rendered.
	 */
	const interactive = $derived(
		clip.type === 'sound' ||
			clip.type === 'ambience' ||
			(clip.type === 'dialogue' && clipHasAudio(clip.id))
	);
	const barCount = $derived(Math.max(6, Math.min(140, Math.floor(wPx / 3))));
	/** active (toggled-on) FX count — drives the fx badge on every clip type */
	const fxCount = $derived(clipEffects(clip).filter((f) => f.on).length);

	/* ------------------------------------------------------------------ */
	/* dragging: move / trim (bottom handles) / fade (top handles)         */
	/* ------------------------------------------------------------------ */

	/** One member of a rigid move group (dragged clip first). */
	interface MoveMember {
		clip: Clip;
		origStart: number;
		origTrackIndex: number;
	}

	let drag: {
		mode: DragMode;
		startX: number;
		origStart: number;
		origDur: number;
		origFadeIn: number;
		origFadeOut: number;
		/** waveform snapshot at drag start — trims cut into this, never stretch */
		origWaveform: number[];
		/** Rigid group for moves (whole multi-selection, dragged clip first). */
		group: MoveMember[];
		/** Lane offset already applied to the group (relative to drag start). */
		laneOffsetApplied: number;
		/** True once the pointer actually moved (distinguishes click from drag). */
		moved: boolean;
	} | null = null;

	/**
	 * Magix-style trim: rebuild the peaks for the new visible length at the
	 * same peaks-per-second, so trimming never stretches the waveform.
	 * Shortening cuts peaks off; extending tiles them for looping ambience
	 * and pads silence (zeros) for one-shots. Unrendered clips stay empty.
	 */
	function fitPeaks(src: number[], targetLen: number, startOffset: number, loop: boolean): number[] {
		if (!src.length || targetLen <= 0) return [];
		const out: number[] = [];
		for (let i = 0; i < targetLen; i++) {
			const j = startOffset + i;
			if (loop) {
				out.push(src[((j % src.length) + src.length) % src.length]);
			} else {
				out.push(j < 0 || j >= src.length ? 0 : src[j]);
			}
		}
		return out;
	}

	function onHandleDown(e: MouseEvent, mode: DragMode) {
		if (clip.rendering) return;
		if (mode !== 'move' && !interactive) return;
		e.preventDefault();
		e.stopPropagation();
		select(e);
		drag = {
			mode,
			startX: e.clientX,
			origStart: clip.start,
			origDur: effDur,
			origFadeIn: clip.fadeIn,
			origFadeOut: clip.fadeOut,
			origWaveform: [...clip.waveform],
			group: mode === 'move' ? buildMoveGroup() : [],
			laneOffsetApplied: 0,
			moved: false
		};
		if (browser) {
			window.addEventListener('mousemove', onWindowMove);
			window.addEventListener('mouseup', onWindowUp);
		}
	}

	/**
	 * Snapshot for a rigid group move: when the dragged clip belongs to a
	 * multi-selection, every selected clip travels with it (same time
	 * delta, same lane offset). Object references stay valid even when
	 * clips are shuffled across lanes mid-drag.
	 */
	function buildMoveGroup(): MoveMember[] {
		const multi = isClipSelected(clip.id) && ui.selectedClipIds.length > 1;
		const ids = multi
			? [...new Set([clip.id, ...ui.selectedClipIds, ...(ui.selectedClipId ? [ui.selectedClipId] : [])])]
			: [clip.id];
		const out: MoveMember[] = [];
		for (const id of ids) {
			const c = id === clip.id ? clip : clipById(id);
			const trackId = c ? trackOfClip(c.id)?.id : undefined;
			const trackIndex = trackId ? project.tracks.findIndex((t) => t.id === trackId) : -1;
			if (!c || trackIndex < 0) continue;
			out.push({ clip: c, origStart: c.start, origTrackIndex: trackIndex });
		}
		return out;
	}

	function onWindowMove(e: MouseEvent) {
		if (!drag) return;
		const dt = (e.clientX - drag.startX) / zoom;

		if (drag.mode === 'move') {
			const self = drag.group[0] ?? { clip, origStart: drag.origStart, origTrackIndex: -1 };
			// Lane offset under the cursor → shift the whole group rigidly
			// (e.g. everything one lane up), clamped so no member leaves the stack.
			if (browser) {
				const laneEl = document
					.elementFromPoint(e.clientX, e.clientY)
					?.closest('[data-lane-id]') as HTMLElement | null;
				const laneId = laneEl?.dataset.laneId;
				if (laneId && self.origTrackIndex >= 0) {
					const curIdx = project.tracks.findIndex((t) => t.id === laneId);
					if (curIdx >= 0) {
						const minOrig = Math.min(...drag.group.map((m) => m.origTrackIndex));
						const maxOrig = Math.max(...drag.group.map((m) => m.origTrackIndex));
						const want = Math.max(
							-minOrig,
							Math.min(project.tracks.length - 1 - maxOrig, curIdx - self.origTrackIndex)
						);
						if (want !== drag.laneOffsetApplied) {
							drag.laneOffsetApplied = want;
							drag.moved = true;
							for (const m of drag.group) {
								const target = project.tracks[m.origTrackIndex + want];
								if (target && trackOfClip(m.clip.id)?.id !== target.id) {
									moveClipToTrack(m.clip.id, target.id);
								}
							}
						}
					}
				}
			}
			// Time shift: the dragged clip drives (snapped), the rest follow rigidly.
			const newSelfStart = Math.max(0, snap(self.origStart + dt));
			const appliedDelta = newSelfStart - self.origStart;
			if (!drag.group.length) clip.start = newSelfStart;
			for (const m of drag.group) {
				m.clip.start = Math.max(0, snap(m.origStart + appliedDelta));
			}
			if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
		} else if (drag.mode === 'trim-left') {
			let newStart = drag.origStart + dt;
			newStart = Math.max(0, Math.min(newStart, drag.origStart + drag.origDur - MIN_DURATION));
			newStart = snap(newStart);
			clip.start = newStart;
			const newDur = +(drag.origDur - (newStart - drag.origStart)).toFixed(2);
			clip.duration = newDur;
			// Refit peaks to the new length from the drag-start snapshot (cut,
			// tile for loops, or pad — never stretch).
			const len = drag.origWaveform.length;
			const targetLen = Math.max(1, Math.round((len * newDur) / drag.origDur));
			const startOffset = Math.round((len * (newStart - drag.origStart)) / drag.origDur);
			clip.waveform = fitPeaks(drag.origWaveform, targetLen, startOffset, clip.type === 'ambience');
		} else if (drag.mode === 'trim-right') {
			const newDur = snap(Math.max(MIN_DURATION, drag.origDur + dt));
			clip.duration = newDur;
			const len = drag.origWaveform.length;
			const targetLen = Math.max(1, Math.round((len * newDur) / drag.origDur));
			clip.waveform = fitPeaks(drag.origWaveform, targetLen, 0, clip.type === 'ambience');
		} else if (drag.mode === 'fade-in') {
			const maxFade = drag.origDur / 2;
			clip.fadeIn = Math.max(0, Math.min(maxFade, +(drag.origFadeIn + dt).toFixed(2)));
		} else if (drag.mode === 'fade-out') {
			const maxFade = drag.origDur / 2;
			clip.fadeOut = Math.max(0, Math.min(maxFade, +(drag.origFadeOut - dt).toFixed(2)));
		}
		// Audition the edit live when playing (debounced transport refresh).
		refreshPlaybackSoon();
	}

	function onWindowUp(e: MouseEvent) {
		// The click that ends a real move-drag on the same clip must not
		// collapse a multi-selection — suppress only then (a release anywhere
		// else targets no clip, so no stale flag may linger).
		if (drag && drag.mode === 'move' && drag.moved && browser) {
			const upEl = document
				.elementFromPoint(e.clientX, e.clientY)
				?.closest('[data-clip-id]') as HTMLElement | null;
			if (upEl?.dataset.clipId === clip.id) suppressClickSelect = true;
		}
		// Clip was already moved during drag if lane changed
		drag = null;
		if (browser) {
			window.removeEventListener('mousemove', onWindowMove);
			window.removeEventListener('mouseup', onWindowUp);
		}
	}

	onDestroy(() => {
		if (drag) {
			// The clip object was moved to another lane mid-drag: Svelte destroys
			// this component instance and mounts a new one for the new lane, but
			// the clip object reference is unchanged. Keep the window listeners
			// alive so the same drag gesture can continue (e.g. back up to the
			// previous lane); onWindowUp still cleans them up on release.
			return;
		}
		if (browser) {
			window.removeEventListener('mousemove', onWindowMove);
			window.removeEventListener('mouseup', onWindowUp);
		}
	});

	function select(e?: MouseEvent) {
		// Ctrl/Cmd+click toggles multi-selection for batch tools (e.g. Insert pause).
		if (e && (e.ctrlKey || e.metaKey)) {
			toggleClipSelected(clip.id);
			return;
		}
		// Pressing (mousedown) an already-selected member of a multi-selection
		// keeps the group so it can be dragged together — the collapse to a
		// single selection happens on click (i.e. press + release without drag).
		if (e && e.type === 'mousedown' && isClipSelected(clip.id) && ui.selectedClipIds.length > 1) {
			return;
		}
		selectClipExclusive(clip.id);
	}

	function openEditor() {
		selectClipExclusive(clip.id);
		ui.editingClipId = clip.id;
		ui.fxClipId = null;
	}

	/** Open the clip's FX menu in the bottom drawer. */
	function openFxPanel() {
		selectClipExclusive(clip.id);
		ui.editingClipId = clip.id;
		ui.fxClipId = clip.id;
	}

	/** FX badge on the clip body (stops the drag/click from reaching the clip). */
	function openFx(e: MouseEvent) {
		e.stopPropagation();
		openFxPanel();
	}

	/* ------------------------------------------------------------------ */
	/* styling                                                             */
	/* ------------------------------------------------------------------ */

	const bg = $derived(
			clip.type === 'sound'
				? 'linear-gradient(180deg, rgba(34,211,238,0.20), rgba(34,211,238,0.07))'
				: clip.rendered && character
					? `linear-gradient(180deg, ${character.color}30, ${character.color}12)`
					: '#1c1f27'
		);
	const borderColor = $derived(
			clip.type === 'sound'
				? 'rgba(34,211,238,0.55)'
				: clip.rendered && character
					? character.color + '90'
					: '#3a3e4a'
		);
	const borderStyle = $derived(clip.type === 'dialogue' && !clip.rendered ? 'dashed' : 'solid');

	/* ------------------------------------------------------------------ */
	/* context menu                                                         */
	/* ------------------------------------------------------------------ */

	let showContextMenu = $state(false);
	let contextMenuPos = $state({ x: 0, y: 0 });

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!isClipSelected(clip.id)) selectClipExclusive(clip.id);
		showContextMenu = true;
		contextMenuPos = { x: e.clientX, y: e.clientY };
	}

	function closeContextMenu() {
		showContextMenu = false;
	}

	function deleteClipFromMenu() {
		deleteClip(clip.id);
		closeContextMenu();
	}

	function duplicateClipFromMenu() {
		// Copy sits right next to the source (same lane, end + gap).
		duplicateClip(clip.id);
		closeContextMenu();
	}

	onMount(() => {
		if (browser) {
			document.addEventListener('click', closeContextMenu);
			document.addEventListener('keydown', handleKeydown);
		}
	});

	onDestroy(() => {
		// Mid-drag destroy = cross-lane remount: the gesture continues through
		// the surviving window listeners (onWindowUp removes them on release),
		// so they must NOT be detached here. This instance's document listeners
		// are always dropped (the remounted instance registers its own).
		if (!drag && browser) {
			window.removeEventListener('mousemove', onWindowMove);
			window.removeEventListener('mouseup', onWindowUp);
		}
		if (browser) {
			document.removeEventListener('click', closeContextMenu);
			document.removeEventListener('keydown', handleKeydown);
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeContextMenu();
	}
</script>

<div
	class="absolute"
	style="left: {shownStart * zoom}px; width: {wPx}px; top: 8px; bottom: 8px;"
	data-clip-id={clip.id}
>
	<!-- clip body -->
	<div
		class="group absolute inset-0 cursor-grab select-none overflow-hidden rounded-lg border active:cursor-grabbing"
		class:ring-2={isSelected || previewShifted}
		class:ring-violet-400={isSelected}
		class:ring-cyan-300={previewShifted && !isSelected}
		class:opacity-40={muted}
		style="background: {bg}; border-color: {borderColor}; border-style: {borderStyle};"
		onmousedown={(e) => onHandleDown(e, 'move')}
		onclick={(e) => {
			e.stopPropagation();
			if (suppressClickSelect) {
				suppressClickSelect = false;
				return;
			}
			select(e);
		}}
		ondblclick={(e) => {
			e.stopPropagation();
			openEditor();
		}}
		oncontextmenu={onContextMenu}
	>
		{#if clip.type === 'dialogue' && !clip.rendered}
			<div class="stripes-pattern pointer-events-none absolute inset-0"></div>
		{/if}

		<div class="relative flex h-full flex-col px-2 py-1.5">
			<!-- header -->
			<div class="pointer-events-none flex min-w-0 items-center gap-1.5">
				{#if clip.type === 'dialogue'}
										{#if character?.face}
											<Avatar face={character.face} size={18} />
										{/if}
										<span class="truncate text-[11px] font-semibold flex items-center gap-1" style="color: {character?.color ?? '#9ca3af'}">
											{#if character}
												{@const p = VOICE_PRESETS.find((vp) => vp.voiceId === character.voiceId)}
												<span class="text-[10px]">{p?.flag ?? '🌐'}</span>
											{/if}
											{character?.name ?? 'Unassigned'}
										</span>
										{#if countTags(clip.text) > 0}
											<span
												class="flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] text-violet-300"
												title="Fish Audio directives (emotions / pauses)"
											>
												<span class="material-symbols-rounded text-[10px]">sell</span>{countTags(clip.text)}
											</span>
										{/if}
										<button
											class="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] transition
												{fxCount > 0
													? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
													: 'border-white/10 bg-white/5 text-gray-500 opacity-0 group-hover:opacity-100'}"
											class:ml-auto={clip.rendered}
											onmousedown={(e) => e.stopPropagation()}
											onclick={openFx}
											title={fxCount > 0
												? `${fxCount} effect${fxCount === 1 ? '' : 's'} on — click to edit FX`
												: 'No effects — click to open FX'}
										>
											<span class="material-symbols-rounded text-[10px]">tune</span>{fxCount > 0 ? `${fxCount} fx` : 'fx'}
										</button>
										{#if !clip.rendered}
											<span
												class="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-amber-500/10 px-1 py-px text-[9px] text-amber-400"
											>
												<span class="material-symbols-rounded text-[10px]">schedule</span>~{effDur.toFixed(1)}s est
											</span>
										{/if}
									{:else if clip.type === 'ambience'}
										<!-- Ambience clip: show layer icons sorted by volume (loudest first) -->
										{#if clip.layers && clip.layers.length > 0}
											<div class="flex items-center gap-0.5 overflow-hidden">
												{#each clip.layers.toSorted((a, b) => b.volume - a.volume) as layer (layer.id)}
													<span
														class="material-symbols-rounded text-[13px] shrink-0 {layer.volume > 0 ? 'text-cyan-300' : 'text-cyan-600/50'}"
														title="{layer.name} ({Math.round(layer.volume * 100)}%)"
													>{layer.icon}</span>
												{/each}
											</div>
										{:else}
											<span class="material-symbols-rounded shrink-0 text-[13px] text-cyan-400/50">{clip.icon}</span>
										{/if}
										<button
											class="pointer-events-auto ml-auto flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] transition
												{fxCount > 0
													? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
													: 'border-white/10 bg-white/5 text-gray-500 opacity-0 group-hover:opacity-100'}"
											onmousedown={(e) => e.stopPropagation()}
											onclick={openFx}
											title={fxCount > 0
												? `${fxCount} effect${fxCount === 1 ? '' : 's'} on — click to edit FX`
												: 'No effects — click to open FX'}
										>
											<span class="material-symbols-rounded text-[10px]">tune</span>{fxCount > 0 ? `${fxCount} fx` : 'fx'}
										</button>
									{:else}
										<span class="material-symbols-rounded shrink-0 text-[13px] text-cyan-300">{clip.icon}</span>
										<span class="truncate text-[11px] font-medium text-cyan-300">{clip.name}</span>
										<button
											class="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] transition
												{fxCount > 0
													? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
													: 'border-white/10 bg-white/5 text-gray-500 opacity-0 group-hover:opacity-100'}"
											onmousedown={(e) => e.stopPropagation()}
											onclick={openFx}
											title={fxCount > 0
												? `${fxCount} effect${fxCount === 1 ? '' : 's'} on — click to edit FX`
												: 'No effects — click to open FX'}
										>
											<span class="material-symbols-rounded text-[10px]">tune</span>{fxCount > 0 ? `${fxCount} fx` : 'fx'}
										</button>
										<span class="ml-auto shrink-0 text-[9px] text-gray-500">{clip.duration.toFixed(1)}s</span>
									{/if}
			</div>

			<!-- waveform / estimate (edge to edge, trimmed waveforms are cut, never stretched) -->
			<div class="pointer-events-none my-0.5 -mx-2 flex min-h-0 flex-1 items-end gap-[2px]">
				{#if clip.waveform.length}
					{#each sampleWaveform(clip.waveform, barCount) as v, i (i)}
						<div
							class="flex-1 rounded-sm"
							style="height: {v * 100}%; background: {clip.type === 'sound' ? 'rgba(103,232,249,0.55)' : 'rgba(196,181,253,0.65)'};"
						></div>
					{/each}
				{:else}
					<div class="flex items-center gap-1 whitespace-nowrap text-[10px] italic text-gray-500">
						<span class="material-symbols-rounded text-[12px]">hourglass_empty</span>
						{clip.type === 'ambience'
							? 'no waveform yet — press Render waveform'
							: clip.type === 'sound'
								? 'no audio — load an MP3 in the editor'
								: 'not rendered — length estimated from text'}
					</div>
				{/if}
			</div>

			<!-- text line (dialogue) -->
			{#if clip.type === 'dialogue'}
				<div class="pointer-events-none truncate text-[10px] leading-tight text-gray-400/90">
					{@html renderTagged(clip.text, 90, true)}
				</div>
			{/if}
		</div>

		<!-- fade overlays -->
		{#if clip.fadeIn > 0}
			<div
				class="pointer-events-none absolute left-0 top-0 bottom-0 bg-[#0d1119]/70"
				style="width: {Math.min(clip.fadeIn, effDur / 2) * zoom}px; clip-path: polygon(0 0, 0 100%, 100% 0);"
			></div>
		{/if}
		{#if clip.fadeOut > 0}
			<div
				class="pointer-events-none absolute right-0 top-0 bottom-0 bg-[#0d1119]/70"
				style="width: {Math.min(clip.fadeOut, effDur / 2) * zoom}px; clip-path: polygon(100% 0, 100% 100%, 0 0);"
			></div>
		{/if}

		<!-- rendering spinner -->
		{#if clip.rendering}
			<div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#0d1119]/60">
				<span class="material-symbols-rounded animate-spin text-lg text-violet-300">progress_activity</span>
			</div>
		{/if}
	</div>

	<!-- drag points: top = fade (like Magix), bottom = cut/trim -->
	{#if interactive && !clip.rendering}
		<div
			class="handle-fade"
			style="left: -5px; top: -5px;"
			title="Drag to fade in"
			onmousedown={(e) => onHandleDown(e, 'fade-in')}
		></div>
		<div
			class="handle-fade"
			style="right: -5px; top: -5px;"
			title="Drag to fade out"
			onmousedown={(e) => onHandleDown(e, 'fade-out')}
		></div>
		<div
			class="handle-trim"
			style="left: 0;"
			title="Drag to cut / trim start"
			onmousedown={(e) => onHandleDown(e, 'trim-left')}
		></div>
		<div
			class="handle-trim"
			style="right: 0;"
			title="Drag to cut / trim end"
			onmousedown={(e) => onHandleDown(e, 'trim-right')}
		></div>
	{/if}

<!-- context menu -->
{#if showContextMenu}
	<div
		class="fixed z-50 bg-[#1e2432] border border-white/10 rounded-lg shadow-xl min-w-[140px] py-1"
		style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;"
		onclick={(e) => e.stopPropagation()}
	>
		<button
			class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
			onclick={() => {
				openEditor();
				closeContextMenu();
			}}
		>
			<span class="material-symbols-rounded text-[15px] text-gray-300">edit</span>Edit clip
		</button>
		<button
			class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
			onclick={() => {
				openFxPanel();
				closeContextMenu();
			}}
		>
			<span class="material-symbols-rounded text-[15px] text-violet-300">tune</span>FX
		</button>
		<button
			class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
			onclick={deleteClipFromMenu}
		>
			<span class="material-symbols-rounded text-[15px] text-red-400">delete</span>Delete
		</button>
		<button
			class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
			onclick={duplicateClipFromMenu}
		>
			<span class="material-symbols-rounded text-[15px] text-cyan-400">content_copy</span>Duplicate
		</button>
	</div>
{/if}
</div>
