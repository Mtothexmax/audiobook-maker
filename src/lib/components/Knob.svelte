<script lang="ts">
	let {
		value = $bindable(0.5),
		label = '',
		icon = '',
		size = 64,
		min = 0,
		max = 1,
		step = 0.01,
		disabled = false
	}: {
		value: number;
		label?: string;
		icon?: string;
		size?: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
	} = $props();

	let isDragging = $state(false);
	let startY = 0;
	let startVal = 0;
	let hasMoved = false;

	// Rotary angle range: -135deg to +135deg (270 degrees total)
	const START_ANGLE = -135;
	const END_ANGLE = 135;
	const TOTAL_ANGLE = END_ANGLE - START_ANGLE;

	const normalized = $derived(Math.max(0, Math.min(1, (value - min) / (max - min))));
	const currentAngle = $derived(START_ANGLE + normalized * TOTAL_ANGLE);
	const pctText = $derived(`${Math.round(normalized * 100)}%`);

	// SVG arc calculation
	const radius = $derived((size / 2) - 8);
	const center = $derived(size / 2);
	const strokeWidth = 5;

	function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
		const rad = ((angleDeg - 90) * Math.PI) / 180.0;
		return {
			x: cx + r * Math.cos(rad),
			y: cy + r * Math.sin(rad)
		};
	}

	function describeArc(cx: number, cy: number, r: number, startA: number, endA: number) {
		const start = polarToCartesian(cx, cy, r, endA);
		const end = polarToCartesian(cx, cy, r, startA);
		const largeArc = endA - startA <= 180 ? 0 : 1;
		return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
	}

	const bgTrackPath = $derived(describeArc(center, center, radius, START_ANGLE, END_ANGLE));
	const activeTrackPath = $derived(
		normalized > 0.01 ? describeArc(center, center, radius, START_ANGLE, currentAngle) : ''
	);

	function onPointerDown(e: PointerEvent) {
		if (disabled) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		isDragging = true;
		hasMoved = false;
		startY = e.clientY;
		startVal = value;
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging || disabled) return;
		const deltaY = startY - e.clientY;
		if (Math.abs(deltaY) > 2) hasMoved = true;

		// 150px drag covers full range 0..1
		const deltaNorm = deltaY / 150;
		const nextNorm = Math.max(0, Math.min(1, (startVal - min) / (max - min) + deltaNorm));
		let newVal = min + nextNorm * (max - min);
		if (step > 0) {
			newVal = Math.round(newVal / step) * step;
		}
		value = Math.max(min, Math.min(max, newVal));
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}

		// If user simply clicked (didn't drag): toggle between 50% (0.50) and 0% (0.00)
		if (!hasMoved) {
			if (value > 0.05) {
				value = 0;
			} else {
				value = 0.5;
			}
		}
	}
</script>

<div class="flex flex-col items-center select-none text-center {disabled ? 'opacity-40 pointer-events-none' : ''}">
	<!-- Label above -->
	{#if label}
		<span class="mb-1 truncate max-w-[85px] text-[10px] font-semibold tracking-wide text-gray-400" title={label}>
			{label}
		</span>
	{/if}

	<!-- Knob body -->
	<div
		class="relative cursor-ns-resize touch-none"
		style="width: {size}px; height: {size}px;"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		role="slider"
		tabindex="0"
		aria-valuenow={value}
		aria-valuemin={min}
		aria-valuemax={max}
		title="{label || 'Volume'}: {pctText} (Click to toggle 50%/0%, drag up/down to adjust)"
	>
		<svg width={size} height={size} class="overflow-visible">
			<!-- Background track -->
			<path
				d={bgTrackPath}
				fill="none"
				stroke="#242b3b"
				stroke-width={strokeWidth}
				stroke-linecap="round"
			/>

			<!-- Active value arc -->
			{#if activeTrackPath}
				<path
					d={activeTrackPath}
					fill="none"
					stroke={normalized > 0 ? '#06b6d4' : '#4b5563'}
					stroke-width={strokeWidth}
					stroke-linecap="round"
				/>
			{/if}

			<!-- Rotating dial face -->
			<g transform="rotate({currentAngle} {center} {center})">
				<circle
					cx={center}
					cy={center}
					r={radius - 4}
					fill="#141a24"
					stroke="#2d3748"
					stroke-width="1.5"
					class="transition-colors hover:stroke-cyan-500/70"
				/>
				<!-- Pointer dot / tick -->
				<circle
					cx={center}
					cy={center - radius + 7}
					r="2"
					fill={normalized > 0 ? '#22d3ee' : '#6b7280'}
				/>
			</g>
		</svg>

		<!-- Center icon / state -->
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			{#if icon}
				<span class="material-symbols-rounded text-[15px] {normalized > 0 ? 'text-cyan-300' : 'text-gray-600'}">
					{icon}
				</span>
			{/if}
		</div>
	</div>

	<!-- Percentage value under knob -->
	<button
		type="button"
		class="mt-1 cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9.5px] transition {normalized > 0 ? 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25' : 'bg-white/5 text-gray-500 hover:bg-white/10'}"
		onclick={() => (value = value > 0.05 ? 0 : 0.5)}
		title="Click to toggle 50% / 0%"
	>
		{pctText}
	</button>
</div>
