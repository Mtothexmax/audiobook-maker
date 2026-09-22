<script lang="ts">
	import type { Track } from '$lib/types';
	import {
		ui,
		toggleMute,
		removeTrack,
		snap,
		addDialogueClip,
		addSoundClip,
		addCategoryClip,
		clearClipSelection,
		charById,
		type SoundPreset,
		type SoundCategory
	} from '$lib/project.svelte';
	import Clip from './Clip.svelte';

	let { track, zoom, gridStep }: { track: Track; zoom: number; gridStep: number } = $props();

	let dragOver = $state(false);

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		dragOver = true;
	}

	function onDragLeave(e: DragEvent) {
		const rel = e.relatedTarget as Node | null;
		const cur = e.currentTarget as HTMLElement;
		if (!rel || !cur.contains(rel)) dragOver = false;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		// Character drop first: creates a dialogue clip for that voice
		let raw = e.dataTransfer?.getData('application/x-character-id');
		if (raw) {
			const characterId = raw.trim();
			if (characterId && charById(characterId)) {
				const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
				const start = Math.max(0, (e.clientX - rect.left) / zoom);
				addDialogueClip(track.id, characterId, snap(start));
				return;
			}
		}
		// Try sound preset first
		raw = e.dataTransfer?.getData('application/x-sound-preset');
		if (raw) {
			try {
				const preset = JSON.parse(raw) as SoundPreset;
				const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
				const start = Math.max(0, (e.clientX - rect.left) / zoom);
				addSoundClip(track.id, preset, snap(start));
				return;
			} catch {
				/* malformed drop payload */
			}
		}
		// Try category
		raw = e.dataTransfer?.getData('application/x-sound-category');
		if (raw) {
			try {
				const category = JSON.parse(raw) as SoundCategory;
				const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
				const start = Math.max(0, (e.clientX - rect.left) / zoom);
				addCategoryClip(track.id, category, snap(start));
				return;
			} catch {
				/* malformed drop payload */
			}
		}
	}

	function onLaneMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			// With Shift/Ctrl held the timeline starts an additive rubber-band
			// select — keep the existing selection in that case.
			if (e.shiftKey || e.ctrlKey || e.metaKey) return;
			clearClipSelection();
			ui.editingClipId = null;
			ui.fxClipId = null;
		}
	}

	function addPreset(preset: SoundPreset) {
		addSoundClip(track.id, preset);
	}
</script>

<div class="flex h-[112px] w-full">
	<!-- lane header (sticky gutter — stays visible during horizontal scroll/zoom) -->
	<div
		class="sticky left-0 z-10 flex w-8 shrink-0 flex-col items-center justify-center gap-3 border-b border-r border-white/10 bg-[#111620]"
	>
		<!-- mute button (vertically centered) -->
		<button
			class="flex h-5 w-5 items-center justify-center rounded transition
				{track.muted
					? 'text-red-400'
					: 'text-gray-500 hover:text-gray-300'}"
			title={track.muted ? 'Unmute lane' : 'Mute lane (all clips)'}
			onclick={() => toggleMute(track.id)}
		>
			<span class="material-symbols-rounded text-[13px]">{track.muted ? 'volume_off' : 'volume_up'}</span>
		</button>

		<!-- remove lane button -->
		<button
			class="flex h-5 w-5 items-center justify-center rounded text-gray-600 transition hover:bg-white/5 hover:text-red-400"
			title="Remove lane"
			onclick={() => removeTrack(track.id)}
		>
			<span class="material-symbols-rounded text-xs">close</span>
		</button>
	</div>

	<!-- lane body: any clip type, any drop -->
	<div
		class="relative flex-1 border-b border-white/10 transition-colors {dragOver ? 'bg-violet-500/10 ring-2 ring-inset ring-violet-400/50' : ''}"
		style="background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 1px, transparent {gridStep}px);"
		data-lane-id={track.id}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		onmousedown={onLaneMouseDown}
	>
		{#each track.clips as clip (clip.id)}
			<Clip {clip} {zoom} muted={track.muted} />
		{/each}
	</div>
</div>
