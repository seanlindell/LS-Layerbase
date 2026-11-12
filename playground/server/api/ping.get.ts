// Answers with the layer's name, which only resolves when the layer's `shared/`
// auto-imports reach the playground's server bundle.
export default defineEventHandler(() => ({ layer: LAYERBASE_NAME }));
