<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Clip } from '$lib/types';
	import {
		ui,
		charById,
		effectiveDuration,
		moveClipToTrack,
		trackOfClip,
		snap,
		clipHasAudio,
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
	const isSelected = $derived(ui.selectedClipId === clip.id);
	const character = $derived(clip.type === 'dialogue' ? charById(clip.characterId) : undefined);
	/** unrendered dialogue clips have no waveform → cannot be trimmed or faded yet */
	const interactive = $derived(
		clip.type === 'sound' || (clip.type === 'dialogue' && clipHasAudio(clip.id))
	);
	const barCount = $derived(Math.max(6, Math.min(140, Math.floor(wPx / 3))));

	/* ------------------------------------------------------------------ */
	/* dragging: move / trim (bottom handles) / fade (top handles)         */
	/* ------------------------------------------------------------------ */

	let drag: {
		mode: DragMode;
		startX: number;
		origStart: number;
		origDur: number;
		origFadeIn: number;
		origFadeOut: number;
	} | null = null;

	function onHandleDown(e: MouseEvent, mode: DragMode) {
		if (clip.rendering) return;
		if (mode !== 'move' && !interactive) return;
		e.preventDefault();
		e.stopPropagation();
		ui.selectedClipId = clip.id;
		drag = {
			mode,
			startX: e.clientX,
			origStart: clip.start,
			origDur: effDur,
			origFadeIn: clip.fadeIn,
			origFadeOut: clip.fadeOut
		};
		window.addEventListener('mousemove', onWindowMove);
		window.addEventListener('mouseup', onWindowUp);
	}

	function onWindowMove(e: MouseEvent) {
		if (!drag) return;
		const dt = (e.clientX - drag.startX) / zoom;

		if (drag.mode === 'move') {
			// lanes are generic — drag a clip onto any other lane
			const laneEl = document
				.elementFromPoint(e.clientX, e.clientY)
				?.closest('[data-lane-id]') as HTMLElement | null;
			const laneId = laneEl?.dataset.laneId;
			if (laneId && laneId !== trackOfClip(clip.id)?.id) {
				moveClipToTrack(clip.id, laneId);
			}
			clip.start = Math.max(0, snap(drag.origStart + dt));
		} else if (drag.mode === 'trim-left') {
			let newStart = drag.origStart + dt;
			newStart = Math.max(0, Math.min(newStart, drag.origStart + drag.origDur - MIN_DURATION));
			newStart = snap(newStart);
			clip.start = newStart;
			clip.duration = +(drag.origDur - (newStart - drag.origStart)).toFixed(2);
		} else if (drag.mode === 'trim-right') {
			clip.duration = snap(Math.max(MIN_DURATION, drag.origDur + dt));
		} else if (drag.mode === 'fade-in') {
			const maxFade = drag.origDur / 2;
			clip.fadeIn = Math.max(0, Math.min(maxFade, +(drag.origFadeIn + dt).toFixed(2)));
		} else if (drag.mode === 'fade-out') {
			const maxFade = drag.origDur / 2;
			clip.fadeOut = Math.max(0, Math.min(maxFade, +(drag.origFadeOut - dt).toFixed(2)));
		}
	}

	function onWindowUp() {
		drag = null;
		window.removeEventListener('mousemove', onWindowMove);
		window.removeEventListener('mouseup', onWindowUp);
	}

	onDestroy(() => {
		if (drag) {
			window.removeEventListener('mousemove', onWindowMove);
			window.removeEventListener('mouseup', onWindowUp);
		}
	});

	function select() {
		ui.selectedClipId = clip.id;
	}

	function openEditor() {
		ui.selectedClipId = clip.id;
		ui.editingClipId = clip.id;
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
</script>

<div
	class="absolute"
	style="left: {clip.start * zoom}px; width: {wPx}px; top: 8px; bottom: 8px;"
	data-clip-id={clip.id}
>
	<!-- clip body -->
	<div
		class="absolute inset-0 cursor-grab select-none overflow-hidden rounded-lg border active:cursor-grabbing"
		class:ring-2={isSelected}
		class:ring-violet-400={isSelected}
		class:opacity-40={muted}
		style="background: {bg}; border-color: {borderColor}; border-style: {borderStyle};"
		onmousedown={(e) => onHandleDown(e, 'move')}
		onclick={(e) => {
			e.stopPropagation();
			select();
		}}
		ondblclick={(e) => {
			e.stopPropagation();
			openEditor();
		}}
	>
		{#if clip.type === 'dialogue' && !clip.rendered}
			<div class="stripes-pattern pointer-events-none absolute inset-0"></div>
		{/if}

		<div class="relative flex h-full flex-col px-2 py-1.5">
			<!-- header -->
			<div class="pointer-events-none flex min-w-0 items-center gap-1.5">
				{#if clip.type === 'dialogue'}
					{#if character}
						<Avatar face={character.face} size={18} />
					{:else}
						<span
							class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-gray-300"
							>?</span
						>
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
					{#if !clip.rendered}
						<span
							class="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-amber-500/10 px-1 py-px text-[9px] text-amber-400"
						>
							<span class="material-symbols-rounded text-[10px]">schedule</span>~{effDur.toFixed(1)}s est
						</span>
					{/if}
				{:else}
					<span class="material-symbols-rounded shrink-0 text-[13px] text-cyan-300">{clip.icon}</span>
					<span class="truncate text-[11px] font-medium text-cyan-300">{clip.name}</span>
					<span class="ml-auto shrink-0 text-[9px] text-gray-500">{clip.duration.toFixed(1)}s</span>
				{/if}
			</div>

			<!-- waveform / estimate -->
			<div class="pointer-events-none my-0.5 flex min-h-0 flex-1 items-end gap-[2px] px-1">
				{#if interactive}
					{#each sampleWaveform(clip.waveform, barCount) as v, i (i)}
						<div
							class="flex-1 rounded-sm"
							style="height: {v * 100}%; background: {clip.type === 'sound' ? 'rgba(103,232,249,0.55)' : 'rgba(196,181,253,0.65)'};"
						></div>
					{/each}
				{:else}
					<div class="flex items-center gap-1 whitespace-nowrap text-[10px] italic text-gray-500">
						<span class="material-symbols-rounded text-[12px]">hourglass_empty</span>
						not rendered — length estimated from text
					</div>
				{/if}
			</div>

			<!-- text line (dialogue) -->
			{#if clip.type === 'dialogue'}
				<div class="pointer-events-none truncate text-[10px] leading-tight text-gray-400/90">
					{@html renderTagged(clip.text, 90)}
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
</div>
