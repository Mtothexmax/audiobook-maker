<script lang="ts">
	import { onMount } from 'svelte';
	import type { FaceConfig } from 'facesjs';

	let {
		face,
		size = 32,
		rounded = 'full',
		class: cls = ''
	}: {
		face: FaceConfig;
		size?: number;
		rounded?: 'full' | 'xl';
		class?: string;
	} = $props();

	let lib = $state<typeof import('facesjs') | null>(null);
	let el = $state<HTMLDivElement | null>(null);

	onMount(() => {
		import('facesjs')
			.then((m) => {
				lib = m;
			})
			.catch((e) => console.error('facesjs load failed', e));
	});

	// re-render whenever the face changes (reroll) — runs after the lazy lib is loaded
	$effect(() => {
		const l = lib;
		const f = face;
		const target = el;
		if (l && target) {
			target.innerHTML = '';
			l.display(target, f);
			// faces.js renders a 400x600 viewBox with xMinYMin alignment —
			// keep the portrait aspect, center it and lift the head into the circle
			const svg = target.querySelector('svg');
			if (svg) {
				svg.style.height = '100%';
				svg.style.width = 'auto';
				svg.style.display = 'block';
				svg.style.transform = 'translateY(-6%)';
			}
		}
	});
</script>

<div
	class="flex shrink-0 items-center justify-center overflow-hidden bg-[#1c2230] {rounded === 'full' ? 'rounded-full' : 'rounded-xl'} ring-1 ring-white/10 {cls}"
	style="width: {size}px; height: {size}px"
	bind:this={el}
></div>
