// Expo's defaults already handle the pnpm monorepo: they watch the workspace root, follow pnpm symlinks to one
// React copy and honour package "exports"/"imports" (S2). The only addition compiles Lingui `.po` catalogs on import.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve("@lingui/metro-transformer/expo");
config.resolver.sourceExts.push("po");
config.resolver.assetExts.push("wasm");

// SQLite's browser worker uses shared memory, including in the local Metro preview.
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
	const handler = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware;
	return (request, response, next) => {
		response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
		response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
		return handler(request, response, next);
	};
};

module.exports = config;
