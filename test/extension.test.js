// ignore.code-scrubber.diagnostics (this file contains fake test credentials)
const assert = require('assert');
const vscode = require('vscode');

// Split so this file never contains a realistic-looking key
const FAKE_AWS_KEY = ['AKIA', 'Q3EGRIUVT6K2XBZP'].join('');

async function waitForDiagnostics(uri, timeout = 5000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const diagnostics = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'Code-Scrubber');
		if (diagnostics.length > 0) {
			return diagnostics;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	return [];
}

suite('Code-Scrubber', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('twilight0963.codescrubber').activate();
	});

	test('reports a masked credential at the right position', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'javascript',
			content: `const config = {};\nconst key = "${FAKE_AWS_KEY}";\n`
		});
		const [diagnostic, ...rest] = await waitForDiagnostics(document.uri);

		assert.ok(diagnostic, 'expected a diagnostic');
		assert.strictEqual(rest.length, 0);
		assert.strictEqual(diagnostic.code, 'aws-access-key-id');
		assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error);
		assert.strictEqual(diagnostic.range.start.line, 1);
		assert.strictEqual(document.getText(diagnostic.range), FAKE_AWS_KEY);
		assert.ok(!diagnostic.message.includes(FAKE_AWS_KEY), 'message must not contain the raw secret');
	});

	test('offers quick fixes only on reported problems', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'javascript',
			content: `const safe = 1;\nconst key = "${FAKE_AWS_KEY}";\n`
		});
		const [diagnostic] = await waitForDiagnostics(document.uri);

		const quickFixTitles = async range => {
			try {
				const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', document.uri, range, vscode.CodeActionKind.QuickFix.value);
				return actions.map(a => a.title);
			} catch (err) {
				// VS Code cancels a request when a newer one for the same document arrives
				if (err.message === 'Canceled') return [];
				throw err;
			}
		};

		// Requests made while VS Code is still starting up can be cancelled or miss
		// freshly published diagnostics, so retry briefly (the real lightbulb re-queries anyway).
		let onFinding = [];
		const start = Date.now();
		while (Date.now() - start < 5000 && !onFinding.includes('Ignore this finding (false positive)')) {
			onFinding = await quickFixTitles(diagnostic.range);
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const onSafeLine = await quickFixTitles(new vscode.Range(0, 0, 0, 5));

		assert.ok(onFinding.includes('Ignore this finding (false positive)'), `got: ${JSON.stringify(onFinding)}`);
		assert.ok(!onSafeLine.some(t => t.includes('credential') || t.includes('finding')), `got: ${JSON.stringify(onSafeLine)}`);
	});

	suite('pre-commit hook', () => {
		const fs = require('fs');
		const os = require('os');
		const path = require('path');
		const { execFileSync } = require('child_process');
		const repos = [];

		function makeRepo() {
			const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-scrubber-ext-')));
			const git = args => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
			git(['init', '-q', '-b', 'main']);
			git(['config', 'user.name', 'Test']);
			git(['config', 'user.email', 'test@example.com']);
			git(['config', 'commit.gpgsign', 'false']);
			repos.push(repo);
			return repo;
		}

		// Commit with a PATH that has git but no Homebrew/nvm Node, so the hook
		// has to use VS Code's built-in runtime
		function commitWithoutNode(repo) {
			fs.writeFileSync(path.join(repo, 'a.js'), `k = "${FAKE_AWS_KEY}"\n`);
			const env = { ...process.env, PATH: '/usr/bin:/bin', CODE_SCRUBBER_NONINTERACTIVE: '1' };
			delete env.ELECTRON_RUN_AS_NODE;
			execFileSync('git', ['add', '-A'], { cwd: repo, env });
			try {
				execFileSync('git', ['commit', '-q', '-m', 'leak'], { cwd: repo, env, stdio: 'pipe' });
				return null;
			} catch (err) {
				return err.stderr.toString();
			}
		}

		const hookFile = repo => path.join(repo, '.git', 'hooks', 'pre-commit');

		suiteTeardown(async () => {
			await vscode.workspace.getConfiguration().update('twilight0963.codescrubber.preCommitHook', undefined, vscode.ConfigurationTarget.Global);
			repos.forEach(repo => fs.rmSync(repo, { recursive: true, force: true }));
		});

		test('install command writes a hook that blocks secrets using VS Code\'s runtime', async () => {
			const repo = makeRepo();
			await vscode.commands.executeCommand('twilight0963.codescrubber.installHook', repo);

			const script = fs.readFileSync(hookFile(repo), 'utf8');
			assert.ok(script.includes('# Installed by code-scrubber'));
			assert.ok(script.includes('globalStorage'), 'hook should point at the stable global storage copy');

			const err = commitWithoutNode(repo);
			assert.ok(err && err.includes('AWS Access Key ID'), `expected the commit to be blocked, got: ${err}`);
			assert.ok(!err.includes('could not find Node'), err);
		});

		test('remove command deletes only our hook', async () => {
			const repo = makeRepo();
			await vscode.commands.executeCommand('twilight0963.codescrubber.installHook', repo);
			await vscode.commands.executeCommand('twilight0963.codescrubber.removeHook', repo);
			assert.ok(!fs.existsSync(hookFile(repo)));
		});

		test('installs automatically when a repository opens and the setting is "always"', async () => {
			await vscode.workspace.getConfiguration().update('twilight0963.codescrubber.preCommitHook', 'always', vscode.ConfigurationTarget.Global);
			const repo = makeRepo();
			const gitApi = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
			await gitApi.openRepository(vscode.Uri.file(repo));

			const start = Date.now();
			while (!fs.existsSync(hookFile(repo)) && Date.now() - start < 10000) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			assert.ok(fs.existsSync(hookFile(repo)), 'hook was not installed');
		});
	});

	test('ignore comment suppresses the finding', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'javascript',
			content: `const key = "${FAKE_AWS_KEY}"; // code-scrubber:ignore\n`
		});
		assert.deepStrictEqual(await waitForDiagnostics(document.uri, 1500), []);
	});
});
