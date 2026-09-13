<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		ui,
		previewPauseGap,
		applyPauseGap,
		setPausePreview,
		clearPausePreview,
		type PauseMode
	} from '$lib/project.svelte';

	let { onclose }: { onclose: () => void } = $props();

	/** Default pause; text is pre-selected so it can be overtyped directly. */
	let raw = $state('0.6');
	/** Unchecked = gaps of *at least* this; checked = gaps of *exactly* this. */
	let exact = $state(false);
	let inputEl = $state<HTMLInputElement | undefined>(undefined);

	const PRESETS = [0.3, 0.6, 1.0];

	/** Free-form seconds — accepts both "0.6" and "0,6". Null while invalid. */
	function parsePause(v: string): number | null {
		const n = parseFloat(v.replace(',', '.').trim());
		return Number.isFinite(n) && n >= 0 ? n : null;
	}

	/** ≥2 clips selected (Ctrl/Cmd+click, rubber-band) → only those; otherwise all clips. */
	const scopeIds = $derived(ui.selectedClipIds.length >= 2 ? [...ui.selectedClipIds] : undefined);
	const scopeHint = $derived(
		scopeIds
			? `${scopeIds.length} Clips ausgewählt`
			: 'Keine Mehrfachauswahl — gilt für alle Clips'
	);

	const parsed = $derived(parsePause(raw));
	const mode: PauseMode = $derived(exact ? 'exact' : 'minimum');
	const preview = $derived(parsed != null ? previewPauseGap(parsed, scopeIds, mode) : null);

	/* Live preview in the TIMELINE (not in this dialog): mirror the computed
	   target positions into the preview overlay — the project itself stays
	   untouched until OK. Cleared on cancel/unmount. */
	$effect(() => {
		if (parsed == null) {
			clearPausePreview();
			return;
		}
		const p = previewPauseGap(parsed, scopeIds, mode);
		const entries: Record<string, number> = {};
		for (const r of p.rows) {
			if (Math.abs(r.shift) > 0.001) entries[r.clipId] = r.newStart;
		}
		setPausePreview(entries);
	});

	onDestroy(() => clearPausePreview());

	function fmt(s: number): string {
		return `${s.toFixed(2)}s`;
	}

	function apply() {
		if (parsed == null) return;
		applyPauseGap(parsed, scopeIds, mode);
		onclose();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
		if (e.key === 'Enter' && parsed != null) apply();
	}

	onMount(() => {
		inputEl?.focus();
		inputEl?.select();
	});
</script>

<svelte:window onkeydown={onKey} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
	role="presentation"
>
	<div
		class="flex max-h-[85vh] w-[440px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e2432] shadow-2xl"
		role="dialog"
		aria-modal="true"
		aria-label="Pause einfügen"
	>
		<div class="flex items-center gap-2 border-b border-white/10 px-4 py-3">
			<span class="material-symbols-rounded text-[18px] text-cyan-300">pause_circle</span>
			<h2 class="text-sm font-semibold text-gray-100">Pause einfügen</h2>
			<button
				class="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/5 hover:text-white"
				title="Schließen"
				onclick={onclose}
			>
				<span class="material-symbols-rounded text-base">close</span>
			</button>
		</div>

		<div class="scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
			<div>
				<label for="pause-secs" class="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-gray-500">
					Pausenabstand in Sekunden
				</label>
				<div class="flex items-center gap-2">
					<input
						id="pause-secs"
						bind:this={inputEl}
						bind:value={raw}
						inputmode="decimal"
						placeholder="z.B. 0.6"
						class="w-32 rounded-lg border border-white/10 bg-[#0e131b] px-3 py-2 font-mono text-sm text-gray-100 outline-none focus:border-cyan-500/60 {parsed == null
							? 'border-red-500/60'
							: ''}"
					/>
					<span class="text-xs text-gray-500">Sekunden</span>
					<div class="ml-1 flex gap-1.5">
						{#each PRESETS as p (p)}
							<button
								class="rounded-md border px-2 py-1 font-mono text-[11px] transition
									{parsed === p
									? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
									: 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'}"
								title="{p.toFixed(1)}s übernehmen"
								onclick={() => (raw = String(p))}
							>
								{p.toFixed(1)}s
							</button>
						{/each}
					</div>
				</div>
				{#if parsed == null}
					<div class="mt-1 text-[11px] text-red-400">Bitte eine Zahl ≥ 0 eingeben (z.B. 0.6 oder 0,6).</div>
				{/if}
				{#if parsed != null}
					<input
						type="range"
						min="0"
						max="3"
						step="0.05"
						value={parsed}
						oninput={(e) => (raw = (e.target as HTMLInputElement).value)}
						class="mt-2 w-full cursor-pointer"
						title="Pausenabstand fein einstellen"
					/>
				{/if}
				<div class="mt-1 text-[11px] text-gray-500">
					{scopeHint}. Aufeinanderfolgende Clips <em>derselben Bahn</em> bekommen
					{exact ? 'exakt' : 'mindestens'} diesen Abstand —
					{exact
						? 'Clips werden bei größeren Lücken auch nach vorne gezogen.'
						: 'Clips werden nur nach hinten geschoben, nie zurückgezogen.'}
				</div>
				<label
					class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-300"
					title="Aktiviert: jeder Abstand wird exakt gesetzt. Deaktiviert: Abstände bleiben mindestens so groß."
				>
					<input type="checkbox" bind:checked={exact} class="h-3.5 w-3.5 shrink-0 accent-cyan-500" />
					Exakte Pausen
				</label>
				<div class="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px] leading-snug">
					{#if parsed == null}
						<span class="text-gray-500">Vorschau pausiert — ungültige Eingabe.</span>
					{:else if preview && preview.rows.length === 0}
						<span class="text-gray-500">Keine Clips im gewählten Bereich.</span>
					{:else if preview && preview.movedCount === 0}
						<span class="text-gray-400"
							>Alle Abstände sind bereits {exact ? 'exakt' : 'mindestens'} {fmt(parsed)} — nichts zu verschieben.</span
						>
					{:else if preview}
						<span class="text-cyan-200">
							{preview.movedCount} von {preview.rows.length} Clips
							{preview.movedCount === 1 ? 'wird' : 'werden'} verschoben{preview.totalAdded > 0
								? ` (+${preview.totalAdded.toFixed(2)}s)`
								: ''}</span
						>
						<span class="text-gray-500"> — die Verschiebung siehst du live in der Timeline.</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
			<button
				class="rounded-lg border border-white/10 bg-[#171c27] px-4 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-[#202635]"
				onclick={onclose}
			>
				Abbrechen
			</button>
			<button
				class="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
				disabled={parsed == null}
				onclick={apply}
			>
				OK
			</button>
		</div>
	</div>
</div>
