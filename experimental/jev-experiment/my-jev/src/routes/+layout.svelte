<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html, body) {
		margin: 0;
		min-height: 100%;
	}

	:global(:root) {
		color-scheme: dark;

		--ink: #15110c;
		--panel: #1e1811;
		--panel-2: #251d14;
		--line: #3a2f21;
		--bone: #ece3d4;
		--muted: #a3947c;
		--copper: #d08a3c;

		--font-display: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
		--font-body: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
		--font-mono: ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace;
	}

	:global(body) {
		min-height: 100vh;
		background-color: var(--ink);
		background-image:
			radial-gradient(60rem 40rem at 10% -15%, rgba(208, 138, 60, 0.15), transparent 60%),
			radial-gradient(55rem 45rem at 105% 115%, rgba(208, 138, 60, 0.07), transparent 55%);
		background-attachment: fixed;
		color: var(--bone);
		font-family: var(--font-body);
		-webkit-font-smoothing: antialiased;
	}
</style>
