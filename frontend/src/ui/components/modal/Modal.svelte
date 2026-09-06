<script lang="ts">
	import Backdrop from "../backdrop/Backdrop.svelte";
	import Button from "../button/Button.svelte";
	import IconButton from "../icon-button/IconButton.svelte";
	import Stack from "../stack/Stack.svelte";
	import type { Snippet } from "svelte";
	import { blur, fade, scale } from "svelte/transition";
	import closeIcon from "../../../../assets/close_icon.svg?url";
    import { bounceIn } from "svelte/easing";

	type ModalProps = {
		readonly showModal: boolean;
		readonly title?: string;
		readonly description?: string;
		readonly header?: Snippet;
		readonly children?: Snippet;
		readonly onConfirm?: () => void;
	};

	let {
		showModal = $bindable(),
		header,
		children,
		title,
		description,
		onConfirm,
	}: ModalProps = $props();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (showModal && dialog) dialog.showModal();
	});

	$effect(() => {
		if (!document) return;

		document.body.onmousedown = (e) => {
			const mouseX = e.x;
			const mouseY = e.y;
			let windowDimensions = dialog?.getBoundingClientRect();

			if (!windowDimensions) return;

			let overWidth =
				mouseX < windowDimensions?.x ||
				mouseX > windowDimensions.x + windowDimensions.width;

			let overHeight =
				mouseY < windowDimensions.y ||
				mouseY > windowDimensions.y + windowDimensions.height;

			if (overWidth || overHeight) {
				return dialog?.close();
			}
			return;
		};
		showModal;
		dialog;
	});
</script>

{#if showModal}
	<Backdrop>
		<dialog
			aria-modal="true"
			tabindex="-1"
			bind:this={dialog}
			onclose={() => (showModal = false)}
			in:scale={{ duration: 300 }}
		>
			<Stack
				row
				sx={{
					textOverflow: "ellipsis",
					width: "100%",
					alignItems: "start",
					paddingBottom: "0.5rem",
					justifyContent: (title || header) ? "space-between" : "flex-end",
				}}
			>
				{#if title}
					<h2 class="modal-title">
						{title}
					</h2>
				{/if}
				{@render header?.()}
				<IconButton
					title="Chiudi"
					src={closeIcon}
					size="small"
					tooltipSx={{
						margin:"-0.3rem",
					}}
					onclick={() => dialog?.close()}
				/>
			</Stack>
			<Stack gap={0.5}>
				{description}
				{@render children?.()}
				<Stack row sx={{ justifyContent: "flex-end" }}>
					{#if onConfirm}
						<Button
							variant="contained"
							type="button"
							onclick={() => {
								showModal = false;
								dialog?.close();
								onConfirm();
							}}
							sx={{
								backgroundColor: "var(--confirm-color)",
							}}
						>
							Conferma
						</Button>
					{/if}
				</Stack>
			</Stack>
		</dialog>
	</Backdrop>
{/if}

<style>
	.modal-title {
		text-align: center;
		font-size: 1.5rem;
		font-weight: 600;
		padding-bottom: 1rem;
	}
	dialog {
		border-radius: 0.5rem;
		border: 2px solid var(--primary-color);
		pointer-events: auto;
	}

	:global([data-theme="dark"]) {
		dialog {
			background-color: var(--dark-theme-background);
			color: var(--dark-theme-text);
		}
	}
	:global([data-theme="light"]) {
		dialog {
			background-color: var(--light-theme-secondary);
			color: var(--light-theme-text);
		}
	}
</style>
