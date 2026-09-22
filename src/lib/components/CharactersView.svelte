<script lang="ts">
	import { project, addCharacter, removeCharacter, rerollFace, removeFace, charById, VOICE_PRESETS } from '$lib/project.svelte';
	import { EMOTIONS } from '$lib/tags';
	import Avatar from './Avatar.svelte';

	function onPresetChange(c: (typeof project.characters)[0], presetId: string) {
		c.voicePreset = presetId;
		if (presetId === 'custom') return;
		const found = VOICE_PRESETS.find((p) => p.id === presetId);
		if (found) {
			c.voiceId = found.voiceId;
			c.language = found.language;
		}
	}
</script>

<div class="h-full overflow-y-auto scrollbar">
	<div class="mx-auto max-w-5xl p-8">
		<!-- header -->
		<div class="mb-6 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-bold text-gray-100">Voice Characters</h2>
				<p class="mt-0.5 text-sm text-gray-500">
					Assign Fish Audio voice profiles — select language presets or enter custom IDs.
				</p>
			</div>
			<div class="flex items-center gap-2">
			<a
				href="https://fish.audio/app/discovery/"
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171c27] px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-[#202635]"
			>
				<span class="material-symbols-rounded text-base">explore</span>
				Discover Voice
			</a>
			<button
				class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
				onclick={() => addCharacter()}
			>
				<span class="material-symbols-rounded text-base">person_add</span>
				Add Character
			</button>
		</div>
		</div>

		{#if project.characters.length === 0}
			<div class="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center text-sm text-gray-500">
				No characters yet. Add one to start casting your dialogue.
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each project.characters as c (c.id)}
					{@const currentPreset = VOICE_PRESETS.find((p) => p.voiceId === c.voiceId)}
					<div class="rounded-xl border border-white/10 bg-[#171c27] p-5">
						<!-- avatar + actions -->
						<div class="flex items-start gap-4">
							<div class="group relative">
								{#if c.face}
									<Avatar face={c.face} size={64} rounded="xl" />
									<button
										class="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#202635] text-violet-300 opacity-0 shadow transition hover:text-white group-hover:opacity-100"
										title="Roll a new face"
										onclick={() => rerollFace(c.id)}
									>
										<span class="material-symbols-rounded text-[13px]">casino</span>
									</button>
									<button
										class="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#202635] text-gray-500 opacity-0 shadow transition hover:text-red-400 group-hover:opacity-100"
										title="Delete avatar"
										onclick={() => removeFace(c.id)}
									>
										<span class="material-symbols-rounded text-[13px]">close</span>
									</button>
								{:else}
									<button
										class="flex h-16 w-16 items-center justify-center rounded-xl bg-white/5 text-lg font-bold text-gray-500 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-gray-300"
										title="Add an avatar"
										onclick={() => rerollFace(c.id)}
									>
										{c.name.trim().charAt(0).toUpperCase() || '?'}
									</button>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<input
									class="w-full border-b border-transparent bg-transparent text-lg font-bold text-gray-100 outline-none transition hover:border-white/10 focus:border-violet-500/60"
									value={c.name}
									oninput={(e) => (c.name = (e.target as HTMLInputElement).value)}
								/>
								<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
									<span>{currentPreset?.flag ?? '🌐'}</span>
									<span class="font-medium">{c.language ?? currentPreset?.language ?? 'English'}</span>
									<span class="text-gray-600">·</span>
									<span class="text-gray-500">#{project.characters.indexOf(c) + 1}</span>
								</div>
							</div>

							<button
								class="rounded-lg p-1.5 text-gray-500 transition hover:bg-red-500/10 hover:text-red-400"
								title="Delete character"
								onclick={() => removeCharacter(c.id)}
							>
								<span class="material-symbols-rounded text-base">delete</span>
							</button>
						</div>

						<!-- fields -->
						<div class="mt-4 space-y-2.5 text-xs">
							<div>
								<label class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
									Voice Preset & Language
								</label>
								<select
									class="w-full rounded border border-white/10 bg-[#0e131b] px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-500/60"
									value={currentPreset?.id ?? (c.voicePreset || 'custom')}
									onchange={(e) => onPresetChange(c, (e.target as HTMLSelectElement).value)}
								>
									<optgroup label="English 🇬🇧 / 🇺🇸 (Default)">
										{#each VOICE_PRESETS.filter((p) => p.language === 'English') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Deutsch 🇩🇪">
										{#each VOICE_PRESETS.filter((p) => p.language === 'Deutsch') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Français 🇫🇷">
										{#each VOICE_PRESETS.filter((p) => p.language === 'Français') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Español 🇪🇸">
										{#each VOICE_PRESETS.filter((p) => p.language === 'Español') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Italiano 🇮🇹">
										{#each VOICE_PRESETS.filter((p) => p.language === 'Italiano') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="日本語 🇯🇵">
										{#each VOICE_PRESETS.filter((p) => p.language === '日本語') as p}
											<option value={p.id}>{p.flag} {p.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Custom">
										<option value="custom">⚙️ Custom Fish Voice ID…</option>
									</optgroup>
								</select>
							</div>

							<div class="grid grid-cols-2 gap-2.5">
								<div>
									<label class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
										Fish Voice ID
									</label>
									<input
										class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 font-mono text-xs text-gray-300 outline-none focus:border-violet-500/60"
										value={c.voiceId}
										oninput={(e) => {
											c.voiceId = (e.target as HTMLInputElement).value;
											c.voicePreset = 'custom';
										}}
									/>
								</div>
								<div>
									<label class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
										Color Badge
									</label>
									<div class="flex items-center gap-2 rounded border border-white/10 bg-[#0e131b] px-2 py-1.5">
										<input
											type="color"
											class="h-6 w-8 cursor-pointer"
											value={c.color}
											oninput={(e) => (c.color = (e.target as HTMLInputElement).value)}
										/>
										<span class="font-mono text-[10px] uppercase text-gray-500">{c.color}</span>
									</div>
								</div>
							</div>

							<div>
								<label class="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
									Default emotion (Fish Audio)
								</label>
								<select
									class="w-full rounded border border-white/10 bg-[#0e131b] px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-violet-500/60"
									value={c.emotion}
									onchange={(e) => (c.emotion = (e.target as HTMLSelectElement).value)}
								>
									{#each EMOTIONS as em}
										<option value={em}>{em}</option>
									{/each}
								</select>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
