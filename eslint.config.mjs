// @ts-check
import withNuxt from "./playground/.nuxt/eslint.config.mjs";

export default withNuxt({
	rules: {
		// Prettier writes `<input />`; without this the two tools undo each other.
		"vue/html-self-closing": ["warn", { html: { void: "any" } }],
	},
});
