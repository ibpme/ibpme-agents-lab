export function registerExtension(extension, methods = {}) {
	const shortcuts = new Map();
	const handlers = new Map();
	extension({
		registerShortcut(key, options) { shortcuts.set(key, options); },
		on(name, handler) {
			const registered = handlers.get(name) ?? [];
			registered.push(handler);
			handlers.set(name, registered);
		},
		...methods,
	});
	return {
		shortcuts,
		async fire(name, event, ctx) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}
