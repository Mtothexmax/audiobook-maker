<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import TimelineView from '$lib/components/TimelineView.svelte';
	import CharactersView from '$lib/components/CharactersView.svelte';
	import ExportView from '$lib/components/ExportView.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { ui, toasts } from '$lib/project.svelte';
</script>

<div class="flex h-screen flex-col overflow-hidden bg-[#0d1119] text-gray-200">
	<Header />

	<main class="flex min-h-0 flex-1 flex-col">
		{#if ui.tab === 'timeline'}
			<TimelineView />
		{:else if ui.tab === 'characters'}
			<CharactersView />
		{:else}
			<ExportView />
		{/if}
	</main>
</div>

<SettingsModal />

<!-- toasts -->
<div class="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
	{#each toasts as t (t.id)}
		<div
			class="flex items-center gap-2 rounded-xl border border-white/10 bg-[#222938] px-4 py-3 text-sm text-gray-200 shadow-2xl"
		>
			<span class="material-symbols-rounded text-base text-violet-400">info</span>
			{t.text}
		</div>
	{/each}
</div>
