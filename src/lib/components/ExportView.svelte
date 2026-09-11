<script lang="ts">
	import { project, buildExport, toast } from '$lib/project.svelte';

	let copied = $state(false);

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
	<div class="mx-auto flex w-full max-w-4xl flex-1 flex-col p-8">
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

		<!-- JSON preview -->
		<pre
			class="scrollbar flex-1 overflow-auto rounded-xl border border-white/10 bg-[#0e131b] p-5 font-mono text-xs leading-relaxed text-emerald-300/90"
		>{JSON.stringify(buildExport(), null, 2)}</pre>
	</div>
</div>
