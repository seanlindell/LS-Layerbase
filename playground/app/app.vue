<script setup lang="ts">
const notifications = usePlaygroundNotifications();
</script>

<template>
	<main>
		<nav>
			<NuxtLink to="/">Home</NuxtLink>
			·
			<NuxtLink to="/notes">Notes</NuxtLink>
		</nav>
		<NuxtPage />
		<!-- The playground's own "toasts". An app would use its UI library here. -->
		<ul aria-live="polite" data-testid="notifications">
			<li v-for="(item, index) in notifications" :key="index">
				<strong>{{ item.kind }}: {{ item.title }}</strong> {{ item.message }}
			</li>
		</ul>
	</main>
</template>
