<script setup lang="ts">
const { data: ping } = await useFetch("/api/ping");
</script>

<template>
	<main>
		<h1>Layerbase playground</h1>
		<p>
			Layer applied: <code data-testid="layer-name">{{ LAYERBASE_NAME }}</code>
		</p>
		<p>
			Server answer: <code data-testid="ping">{{ ping }}</code>
		</p>
	</main>
</template>
