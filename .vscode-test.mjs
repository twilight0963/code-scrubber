import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'test/**/*.test.js',
	// A freshly launched VS Code can take a few seconds to answer the first requests
	mocha: { timeout: 20000 },
});
