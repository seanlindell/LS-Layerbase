<script setup lang="ts">
import type { Note } from "../../server/utils/notes";

// Try these titles: a new one (200), an empty one (400), "First note" (409, with
// the existing note as the payload), "upstream" (502) and "bug" (500).
const { run, notifySuccess } = useApi();

const title = ref("");
const isSaving = ref(false);
const created = ref<Note[]>([]);
const existing = ref<Note | null>(null);

function isNote(value: unknown): value is Note {
	return typeof value === "object" && value !== null && "id" in value && "title" in value;
}

async function addNote() {
	existing.value = null;
	const result = await run<Note>("/api/notes", {
		method: "POST",
		body: { title: title.value },
		pending: isSaving,
		errorTitle: "Could not create the note",
	});

	if (result.Success) {
		created.value.push(result.ResponseObject);
		notifySuccess(result.Message);
		title.value = "";
	} else if (result.Status === 409 && isNote(result.ResponseObject)) {
		// The refused write carries the note that already exists. No second request.
		existing.value = result.ResponseObject;
	}
}
</script>

<template>
	<section>
		<h1>Notes</h1>
		<form data-testid="note-form" @submit.prevent="addNote">
			<label>
				Title
				<input v-model="title" name="title" />
			</label>
			<button type="submit" :disabled="isSaving">Add note</button>
		</form>
		<p v-if="existing" data-testid="existing">
			That note already exists: #{{ existing.id }} "{{ existing.title }}"
		</p>
		<ul data-testid="created">
			<li v-for="note in created" :key="note.id">#{{ note.id }} {{ note.title }}</li>
		</ul>
	</section>
</template>
