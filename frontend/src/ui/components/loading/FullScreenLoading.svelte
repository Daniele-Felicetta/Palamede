<script lang="ts">
import { primaryColor } from "$lib/theme/theme";
import AbsoluteCenter from "../absolute-center/AbsoluteCenter.svelte";
import Backdrop from "../backdrop/Backdrop.svelte";
import FullScreenWrapper from "../full-screen-wrapper/FullScreenWrapper.svelte";
import Loading, { type LoadingProps } from "./Loading.svelte";

type FullScreenLoadingProps = Omit<LoadingProps, "center"> & {
	readonly backdrop?: boolean;
};

const { backdrop, ...restProps }: FullScreenLoadingProps = $props();
</script>

<FullScreenWrapper {backdrop}>
  <Loading {...restProps} />
</FullScreenWrapper>
