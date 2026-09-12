<script lang="ts">
	import { ui, project, normalizeVoiceClips } from '$lib/project.svelte';

	let showTools = $state(false);

	type TabId = 'timeline' | 'characters' | 'export';
	const tabs: { id: TabId; label: string; icon: string; count?: () => number }[] = [
		{ id: 'timeline', label: 'Timeline', icon: 'view_timeline' },
		{ id: 'characters', label: 'Characters', icon: 'people', count: () => project.characters.length },
		{ id: 'export', label: 'Export', icon: 'download' }
	];
</script>

<header class="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#111620] px-4">
	<!-- brand -->
	<div class="flex w-56 items-center gap-2">
		<span class="material-symbols-rounded text-[22px] text-violet-400">auto_stories</span>
		<div class="leading-tight">
			<div class="text-sm font-semibold tracking-tight text-gray-100">Audiobook Studio</div>
				<div class="text-[10px] text-gray-500">Fish Audio TTS</div>
		</div>
	</div>

	<!-- Gemini-style tabs -->
	<nav class="flex gap-1 rounded-lg border border-white/10 bg-[#0d1119] p-1">
		{#each tabs as t (t.id)}
			<button
				class="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition
					{ui.tab === t.id ? 'bg-violet-600 text-white shadow' : 'text-gray-400 hover:text-white'}"
				onclick={() => (ui.tab = t.id)}
			>
				<span class="material-symbols-rounded text-sm">{t.icon}</span>
				{t.label}
				{#if t.count}
					<span
						class="rounded-full px-1.5 text-[10px] {ui.tab === t.id ? 'bg-white/20' : 'bg-white/10 text-gray-400'}"
						>{t.count()}</span
					>
				{/if}
			</button>
		{/each}
	</nav>

	<!-- project name -->
	<div class="ml-4 hidden min-w-0 flex-1 items-center justify-center lg:flex">
		<input
			class="w-64 rounded border-b border-transparent bg-transparent px-1 py-0.5 text-center text-sm text-gray-400 outline-none transition hover:border-white/10 focus:border-violet-500/60 focus:text-gray-200"
			value={project.name}
			oninput={(e) => (project.name = (e.target as HTMLInputElement).value)}
			placeholder="Project name"
		/>
	</div>

	<div class="flex-1 lg:hidden"></div>

	<!-- tools menu -->
	<div class="relative">
		<button
			class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white"
			title="Tools"
			onclick={() => (showTools = !showTools)}
		>
			<span class="material-symbols-rounded text-[19px]">auto_fix_high</span>
		</button>
		{#if showTools}
			<div
				class="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#202635] shadow-2xl"
			>
				<button
					class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 transition hover:bg-white/5"
					onclick={() => {
						showTools = false;
						normalizeVoiceClips();
					}}
					title="Measure rendered voice clips and set a Loudness FX per voice so all match"
				>
					<span class="material-symbols-rounded text-[15px] text-cyan-300">equalizer</span>
					<span class="flex-1">Normalize voice clips</span>
				</button>
				<div class="px-3 pb-2 text-[10px] leading-snug text-gray-500">
					Sets a Loudness FX on every rendered voice clip so all voices match.
				</div>
			</div>
		{/if}
	</div>

	<!-- settings -->
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white"
		title="Settings — Fish Audio API key"
		onclick={() => (ui.settingsOpen = true)}
	>
		<span class="material-symbols-rounded text-[19px]">settings</span>
	</button>
</header>
