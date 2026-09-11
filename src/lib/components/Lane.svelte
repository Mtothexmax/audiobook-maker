<script lang="ts">
	import type { Track } from '$lib/types';
	import {
		SOUND_PRESETS,
		ui,
		toast,
		toggleMute,
		addLineClip,
		addSoundClip,
		removeTrack,
		snap,
		type SoundPreset
	} from '$lib/project.svelte';
	import Clip from './Clip.svelte';

	let { track, zoom, gridStep }: { track: Track; zoom: number; gridStep: number } = $props();

	let showSoundMenu = $state(false);
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
		const raw = e.dataTransfer?.getData('application/x-sound-preset');
		if (!raw) return;
		try {
			const preset = JSON.parse(raw) as SoundPreset;
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const start = Math.max(0, (e.clientX - rect.left) / zoom);
			addSoundClip(track.id, preset, snap(start));
		} catch {
			/* malformed drop payload */
		}
	}

	function onLaneMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			ui.selectedClipId = null;
			ui.editingClipId = null;
		}
	}

	function addPreset(preset: SoundPreset) {
		addSoundClip(track.id, preset);
		showSoundMenu = false;
	}
</script>

<div class="flex h-[112px] w-full">
	<!-- lane header (sticky gutter) -->
	<div
		class="relative z-10 flex w-40 shrink-0 flex-col justify-center gap-1 border-b border-r border-white/10 bg-[#111620] px-3 py-2"
	>
		<button
			class="absolute right-1 top-1 rounded p-0.5 text-gray-600 hover:text-red-400"
			title="Remove lane"
			onclick={() => removeTrack(track.id)}
		>
			<span class="material-symbols-rounded text-sm">close</span>
		</button>
		<input
			class="w-full truncate bg-transparent pr-5 text-xs font-semibold text-gray-200 outline-none"
			value={track.name}
			oninput={(e) => (track.name = (e.target as HTMLInputElement).value)}
		/>
		<div class="flex items-center gap-1.5">
			<span class="material-symbols-rounded text-[13px] text-cyan-400/80">view_timeline</span>
			<span class="text-[10px] text-gray-500"
				>{track.clips.length} clip{track.clips.length === 1 ? '' : 's'}</span
			>
			<!-- mute button: mutes every clip on this lane -->
			<button
				class="ml-auto flex h-6 w-6 items-center justify-center rounded-md transition
					{track.muted
						? 'bg-red-500/20 text-red-400'
						: 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}"
				title={track.muted ? 'Unmute lane' : 'Mute lane (all clips)'}
				onclick={() => toggleMute(track.id)}
			>
				<span class="material-symbols-rounded text-[14px]">{track.muted ? 'volume_off' : 'volume_up'}</span>
			</button>
		</div>
		<div class="mt-0.5 flex items-center gap-1">
			<button
				class="flex items-center gap-0.5 text-[11px] text-violet-300 hover:text-violet-200"
				title="Add a dialogue clip at the end of the lane"
				onclick={() => addLineClip(track.id)}
			>
				<span class="material-symbols-rounded text-[13px]">add_comment</span>line
			</button>
			<div class="relative">
				<button
					class="flex items-center gap-0.5 text-[11px] text-cyan-300 hover:text-cyan-200"
					title="Add a sound at the end of the lane — or drag one from the sound library onto any lane"
					onclick={() => (showSoundMenu = !showSoundMenu)}
				>
					<span class="material-symbols-rounded text-[13px]">add</span>sound
				</button>
				{#if showSoundMenu}
					<div
						class="absolute left-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border border-white/10 bg-[#202635] shadow-2xl"
					>
						{#each SOUND_PRESETS as p (p.name)}
							<button
								class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
								onclick={() => addPreset(p)}
							>
								<span class="material-symbols-rounded text-[15px] text-cyan-300">{p.icon}</span>
								<span class="flex-1">{p.name}</span>
								<span class="text-[10px] text-gray-500">{p.duration}s</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
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

		{#if track.clips.length === 0 && !dragOver}
			<div
				class="pointer-events-none absolute left-3 top-4 flex h-14 w-60 items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.02] text-[11px] text-gray-600"
			>
				<span class="material-symbols-rounded text-sm">file_download</span>
				Drop any clip or sound here
			</div>
		{/if}
	</div>
</div>
