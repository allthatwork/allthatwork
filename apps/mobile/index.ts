// The polyfills must run before any app or package module evaluates.
import "./src/polyfills";

// Warm the web SQLite worker before theme/preferences make synchronous reads during module evaluation.
if (process.env.EXPO_OS === "web") {
	void import("expo-sqlite/kv-store")
		.then(({ default: storage }) => storage.getItem("theme"))
		.then(() => require("./src/dev/web-preview"));
} else {
	require("expo-router/entry");
}
