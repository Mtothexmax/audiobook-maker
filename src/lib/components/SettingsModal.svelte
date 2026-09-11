<script lang="ts">
	import {
		settings,
		ui,
		setFishAudioApiKey,
		clearFishAudioApiKey,
		setFishModel,
		FISH_MODELS
	} from '$lib/project.svelte';

	let showKey = $state(false);
	let savedFlash = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function onInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		setFishAudioApiKey(v);
		savedFlash = true;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => (savedFlash = false), 1600);
	}

	function clear() {
		clearFishAudioApiKey();
		savedFlash = false;
	}
</script>

{#if ui.settingsOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
		onclick={(e) => {
			if (e.target === e.currentTarget) ui.settingsOpen = false;
		}}
	>
		<div class="w-full max-w-md rounded-2xl border border-white/10 bg-[#171c27] shadow-2xl">
			<!-- header -->
			<div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
				<h2 class="flex items-center gap-2 text-sm font-semibold text-gray-100">
					<span class="material-symbols-rounded text-violet-400">settings</span>
					Settings
				</h2>
				<button
					class="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white"
					onclick={() => (ui.settingsOpen = false)}
					aria-label="Close settings"
				>
					<span class="material-symbols-rounded text-lg">close</span>
				</button>
			</div>

			<div class="space-y-5 px-5 py-5">
				<!-- Fish Audio API key -->
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<label class="text-xs font-semibold uppercase tracking-widest text-gray-500"
							>Fish Audio API key</label
						>
						{#if settings.fishAudioApiKey}
							<span class="flex items-center gap-1 text-[11px] text-emerald-400">
								<span class="material-symbols-rounded text-sm">check_circle</span>
								configured
							</span>
						{:else}
							<span class="text-[11px] text-amber-400/90">not set</span>
						{/if}
					</div>
					<div
						class="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0e131b] px-3 py-2 focus-within:border-violet-500/60"
					>
						<span class="material-symbols-rounded text-base text-gray-600">key</span>
						<input
							type={showKey ? 'text' : 'password'}
							value={settings.fishAudioApiKey}
							oninput={onInput}
							placeholder="fa-xxxxxxxx…"
							spellcheck="false"
							class="w-full bg-transparent font-mono text-sm text-gray-200 outline-none placeholder:text-gray-600"
						/>
						<button
							class="rounded p-1 text-gray-500 hover:text-gray-200"
							onclick={() => (showKey = !showKey)}
							title={showKey ? 'Hide key' : 'Show key'}
						>
							<span class="material-symbols-rounded text-base">{showKey ? 'visibility_off' : 'visibility'}</span>
						</button>
					</div>
					<div class="mt-2 flex items-center justify-between text-[11px] text-gray-500">
						<span>Stored locally in your browser (localStorage) — used only client-side.</span>
						{#if savedFlash}
							<span class="flex items-center gap-1 text-emerald-400">
								<span class="material-symbols-rounded text-xs">cloud_done</span>saved
							</span>
						{/if}
					</div>
				</div>

				{#if settings.fishAudioApiKey}
					<div class="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-gray-500">
						Key <code class="font-mono text-gray-400">{settings.fishAudioApiKey.slice(0, 8)}…</code>
						will be sent to the Fish Audio API for rendering.
					</div>
				{/if}

				<!-- engine info -->
					<div class="border-t border-white/10 pt-4">
						<div class="mb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500"
							>Voice engine</div
						>
						<div class="flex items-center gap-2 text-sm text-gray-300">
							<span class="material-symbols-rounded text-base text-cyan-400">graphic_eq</span>
							Fish Audio
							<span class="text-[11px] text-gray-600">— emotions & pauses via [emotion:x] / [pause:x]</span>
						</div>
						<label class="mt-3 block">
							<span class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500"
								>Model</span
							>
							<select
								class="w-full rounded-lg border border-white/10 bg-[#0e131b] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/60"
								value={settings.fishModel}
								onchange={(e) => setFishModel((e.target as HTMLSelectElement).value)}
							>
								{#each FISH_MODELS as m (m.id)}
									<option value={m.id}>{m.label}</option>
								{/each}
							</select>
						</label>
						<p class="mt-1.5 text-[11px] leading-snug text-gray-500">
							Use <code class="font-mono">s2.1-pro-free</code> while developing — it stays on the free
							tier.
						</p>
					</div>
			</div>

			<!-- footer -->
			<div class="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
				{#if settings.fishAudioApiKey}
					<button
						class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
						onclick={clear}
					>
						Remove key
					</button>
				{/if}
				<button
					class="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
					onclick={() => (ui.settingsOpen = false)}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
