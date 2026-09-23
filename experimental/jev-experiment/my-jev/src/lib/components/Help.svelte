<script lang="ts">
	let { text, label = 'Aiuto' }: { text: string; label?: string } = $props();
	const id = $props.id();
</script>

<span class="help">
	<button type="button" class="dot" aria-label={label} aria-describedby={id}>
		<span aria-hidden="true">?</span>
	</button>
	<span class="tip" id={id} role="tooltip">{text}</span>
</span>

<style>
	.help {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}

	.dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		line-height: 1;
		cursor: help;
	}

	.dot:hover,
	.dot:focus-visible {
		border-color: var(--copper);
		color: var(--copper);
	}

	.dot:focus-visible {
		outline: 2px solid var(--copper);
		outline-offset: 2px;
	}

	.tip {
		position: absolute;
		top: calc(100% + 0.4rem);
		left: 50%;
		z-index: 20;
		width: max-content;
		max-width: min(16rem, 70vw);
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: #0f0c08;
		color: var(--bone);
		font-family: var(--font-body);
		font-size: 0.78rem;
		line-height: 1.4;
		text-align: left;
		text-wrap: pretty;
		opacity: 0;
		visibility: hidden;
		transform: translate(-50%, -2px);
		transition:
			opacity 0.12s ease,
			transform 0.12s ease;
		pointer-events: none;
	}

	.help:hover .tip,
	.help:focus-within .tip {
		opacity: 1;
		visibility: visible;
		transform: translate(-50%, 0);
	}

	@media (prefers-reduced-motion: reduce) {
		.tip {
			transition: none;
		}
	}
</style>
