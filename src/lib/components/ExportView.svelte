<script lang="ts">
	import { project, buildExport, importProject, exportTimelineMp3, toast } from '$lib/project.svelte';

	let copied = $state(false);
	let showImport = $state(false);
	let importText = $state('');
	let importError = $state<string | null>(null);
	let exportingMp3 = $state(false);

	function loadJson() {
		const result = importProject(importText);
		if (result.ok) {
			showImport = false;
			importText = '';
			importError = null;
		} else {
			importError = result.error;
		}
	}

	function copyJson() {
		navigator.clipboard
			.writeText(JSON.stringify(buildExport(), null, 2))
			.then(() => {
				copied = true;
				toast('Project JSON copied to clipboard');
				setTimeout(() => (copied = false), 1500);
			})
			.catch(() => toast('Clipboard unavailable'));
	}

	async function downloadMp3() {
		if (exportingMp3) return;
		exportingMp3 = true;
		try {
			const result = await exportTimelineMp3();
			if (!result) return;
			const url = URL.createObjectURL(result.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = (project.name || 'audiobook').replace(/\s+/g, '_') + '.mp3';
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
			toast(`Hörspiel exported as MP3 (${result.duration.toFixed(0)}s)`);
		} catch (e) {
			toast(e instanceof Error ? `MP3 export failed: ${e.message}` : 'MP3 export failed');
		} finally {
			exportingMp3 = false;
		}
	}

	function downloadJson() {
		const data = JSON.stringify(buildExport(), null, 2);
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = (project.name || 'audiobook').replace(/\s+/g, '_') + '.json';
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		toast('Project exported as JSON');
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col p-8">
		<!-- header -->
		<div class="mb-4 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-bold text-gray-100">Project Export</h2>
				<p class="mt-0.5 text-sm text-gray-500">
					A flat, human-readable format — characters, lanes and clips with timing, fades and
					Fish Audio directives inline.
				</p>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
					onclick={downloadMp3}
					disabled={exportingMp3}
					title="Bounce the full timeline (all lanes, fades, ambience) to an MP3 file"
				>
					<span class="material-symbols-rounded text-sm {exportingMp3 ? 'animate-spin' : ''}">
						{exportingMp3 ? 'progress_activity' : 'audio_file'}
					</span>
					{exportingMp3 ? 'Rendering...' : 'Download MP3'}
				</button>
				<button
					class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171c27] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-[#202635]"
					onclick={() => {
						showImport = !showImport;
						importError = null;
					}}
					title="Paste a previously exported project JSON to load it"
				>
					<span class="material-symbols-rounded text-sm">upload</span>
					Import JSON
				</button>
				<button
					class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171c27] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-[#202635]"
					onclick={copyJson}
				>
					<span class="material-symbols-rounded text-sm">{copied ? 'check' : 'content_copy'}</span>
					{copied ? 'Copied' : 'Copy JSON'}
				</button>
				<button
					class="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
					onclick={downloadJson}
				>
					<span class="material-symbols-rounded text-sm">download</span>
					Download .json
				</button>
			</div>
		</div>

		{#if showImport}
			<div class="mb-4 shrink-0 rounded-xl border border-white/10 bg-[#0e131b] p-4">
				<div class="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
					Paste project JSON to load it (replaces the current project)
				</div>
				<textarea
					bind:value={importText}
					rows={5}
					spellcheck="false"
					class="scrollbar w-full resize-none rounded-lg border border-white/10 bg-[#151a24] p-3 font-mono text-xs leading-relaxed text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/60"
					placeholder='Paste a previously exported project JSON here, then press "Load project".'
				></textarea>
				{#if importError}
					<div
						class="mt-2 flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-snug text-red-300"
					>
						<span class="material-symbols-rounded text-sm">error</span>
						<span>{importError}</span>
					</div>
				{/if}
				<div class="mt-2 flex justify-end gap-2">
					<button
						class="rounded-lg border border-white/10 bg-[#202635] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-[#262b36]"
						onclick={() => {
							showImport = false;
							importText = '';
							importError = null;
						}}
					>
						Cancel
					</button>
					<button
						class="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
						disabled={!importText.trim()}
						onclick={loadJson}
					>
						Load project
					</button>
				</div>
			</div>
		{/if}

		<!-- JSON preview -->
		<pre
			class="scrollbar min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-[#0e131b] p-5 font-mono text-xs leading-relaxed text-emerald-300/90"
		>{JSON.stringify(buildExport(), null, 2)}</pre>
	</div>
</div>
