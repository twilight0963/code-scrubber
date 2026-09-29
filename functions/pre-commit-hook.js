const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const hook = require('../cli/hook');

const SETTING = 'twilight0963.codescrubber.preCommitHook';
const CHOICES_KEY = 'preCommitHookChoices';

// Repos where the user picked "Not now" (this session only)
const notNow = new Set();
let statusBar = null;
let gitApi = null;

/**
 * Copy the CLI and its dependencies into the extension's global storage.
 * Extension folders are versioned (…/codescrubber-1.0.0), so a hook pointing
 * there would break on update; the global storage path stays the same.
 * @param {vscode.ExtensionContext} context
 * @returns {string} path to the CLI entry point
 */
function ensureRuntime(context) {
    const dest = path.join(context.globalStorageUri.fsPath, 'runtime');
    const cliPath = path.join(dest, 'bin', 'code-scrubber.js');
    const version = context.extension.packageJSON.version;
    const stamp = path.join(dest, '.version');
    const isDev = context.extensionMode !== vscode.ExtensionMode.Production;
    if (!isDev && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) {
        return cliPath;
    }

    const src = context.extensionPath;
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    const skipTests = source => !/[\\/]test([\\/]|$)/.test(path.relative(src, source));
    for (const dir of ['core', 'cli', 'bin']) {
        fs.cpSync(path.join(src, dir), path.join(tmp, dir), { recursive: true, filter: skipTests });
    }
    fs.copyFileSync(path.join(src, 'package.json'), path.join(tmp, 'package.json'));

    // Runtime dependencies (is-gibberish and what it needs)
    const copied = new Set();
    const copyDeps = pkgDir => {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        for (const name of Object.keys(pkg.dependencies || {})) {
            if (copied.has(name)) continue;
            const depDir = path.join(src, 'node_modules', name);
            if (!fs.existsSync(depDir)) continue;
            copied.add(name);
            fs.cpSync(depDir, path.join(tmp, 'node_modules', name), { recursive: true });
            copyDeps(depDir);
        }
    };
    copyDeps(src);

    fs.writeFileSync(path.join(tmp, '.version'), version);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return cliPath;
}

async function getGitApi() {
    const extension = vscode.extensions.getExtension('vscode.git');
    if (!extension) return null;
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports && exports.enabled ? exports.getAPI(1) : null;
}

function install(context, repoRoot, options = {}) {
    return hook.installHook(repoRoot, {
        cliPath: ensureRuntime(context),
        // VS Code's own runtime, used with ELECTRON_RUN_AS_NODE when `node` isn't on PATH
        fallbackNode: process.execPath,
        allowCustomHooksPath: false,
        ...options
    });
}

function rememberChoice(context, repoRoot, choice) {
    const choices = context.globalState.get(CHOICES_KEY, {});
    choices[repoRoot] = choice;
    return context.globalState.update(CHOICES_KEY, choices);
}

async function showManualInstructions(context, repoRoot, reason) {
    const line = hook.manualHookLine(ensureRuntime(context));
    const pick = await vscode.window.showInformationMessage(
        `"${path.basename(repoRoot)}" ${reason}. To add Code-Scrubber, add this line to your pre-commit hook: ${line}`,
        'Copy line',
        "Don't show again"
    );
    if (pick === 'Copy line') {
        await vscode.env.clipboard.writeText(line);
    } else if (pick === "Don't show again") {
        await rememberChoice(context, repoRoot, 'never');
    }
}

/**
 * Called whenever a repository opens (including "Initialize Repository").
 * @param {vscode.ExtensionContext} context
 * @param {string} repoRoot
 */
async function offerHook(context, repoRoot) {
    const mode = vscode.workspace.getConfiguration().get(SETTING, 'prompt');
    let status;
    try {
        status = hook.hookStatus(repoRoot);
    } catch {
        return; // not a usable git repo (yet)
    }

    // Keep our hook's paths current (extension or VS Code may have moved)
    if (status === 'ours') {
        install(context, repoRoot);
        updateStatusBar();
        return;
    }
    if (mode === 'never') return;

    const choices = context.globalState.get(CHOICES_KEY, {});
    if (choices[repoRoot] === 'never' || notNow.has(repoRoot)) return;

    if (status === 'foreign') {
        await showManualInstructions(context, repoRoot, 'already has a pre-commit hook');
        return;
    }

    if (mode === 'always') {
        const { result } = install(context, repoRoot);
        if (result === 'custom-hooks-path') {
            await showManualInstructions(context, repoRoot, 'uses a hook manager (core.hooksPath)');
        } else {
            vscode.window.showInformationMessage(`Code-Scrubber pre-commit hook installed in "${path.basename(repoRoot)}".`);
        }
        updateStatusBar();
        return;
    }

    const pick = await vscode.window.showInformationMessage(
        `Protect "${path.basename(repoRoot)}" from committing secrets? Code-Scrubber can install a pre-commit hook that blocks commits adding API keys or passwords.`,
        'Install hook',
        'Not now',
        'Never for this repo'
    );
    if (pick === 'Install hook') {
        await installCommand(context, repoRoot);
    } else if (pick === 'Never for this repo') {
        await rememberChoice(context, repoRoot, 'never');
    } else {
        notNow.add(repoRoot);
    }
}

async function pickRepo(repoRoot) {
    if (typeof repoRoot === 'string') return repoRoot;
    if (!gitApi || gitApi.repositories.length === 0) {
        vscode.window.showWarningMessage('No git repository is open.');
        return null;
    }
    const active = activeRepo();
    if (gitApi.repositories.length === 1 || active) {
        return (active || gitApi.repositories[0]).rootUri.fsPath;
    }
    const pick = await vscode.window.showQuickPick(
        gitApi.repositories.map(r => ({ label: path.basename(r.rootUri.fsPath), description: r.rootUri.fsPath })),
        { placeHolder: 'Choose a repository' }
    );
    return pick ? pick.description : null;
}

async function installCommand(context, repoRoot) {
    repoRoot = await pickRepo(repoRoot);
    if (!repoRoot) return;
    const { result } = install(context, repoRoot);
    if (result === 'foreign') {
        const pick = await vscode.window.showWarningMessage(
            `"${path.basename(repoRoot)}" already has a pre-commit hook.`,
            { modal: true, detail: 'You can replace it, or add Code-Scrubber to it yourself.' },
            'Replace existing hook',
            'Show line to add'
        );
        if (pick === 'Replace existing hook') {
            install(context, repoRoot, { force: true });
        } else if (pick === 'Show line to add') {
            await showManualInstructions(context, repoRoot, 'already has a pre-commit hook');
            return;
        } else {
            return;
        }
    } else if (result === 'custom-hooks-path') {
        await showManualInstructions(context, repoRoot, 'uses a hook manager (core.hooksPath)');
        return;
    }
    await rememberChoice(context, repoRoot, 'installed');
    vscode.window.showInformationMessage(`Code-Scrubber will now block commits that add secrets in "${path.basename(repoRoot)}".`);
    updateStatusBar();
}

async function removeCommand(context, repoRoot) {
    repoRoot = await pickRepo(repoRoot);
    if (!repoRoot) return;
    if (hook.uninstallHook(repoRoot)) {
        await rememberChoice(context, repoRoot, 'never');
        vscode.window.showInformationMessage(`Code-Scrubber pre-commit hook removed from "${path.basename(repoRoot)}".`);
    } else {
        vscode.window.showInformationMessage(`"${path.basename(repoRoot)}" doesn't have a Code-Scrubber pre-commit hook.`);
    }
    updateStatusBar();
}

function activeRepo() {
    if (!gitApi) return null;
    const editor = vscode.window.activeTextEditor;
    return (editor && gitApi.getRepository(editor.document.uri)) ||
        (gitApi.repositories.length === 1 ? gitApi.repositories[0] : null);
}

function updateStatusBar() {
    if (!statusBar) return;
    const repo = activeRepo();
    if (!repo) {
        statusBar.hide();
        return;
    }
    let status;
    try {
        status = hook.hookStatus(repo.rootUri.fsPath);
    } catch {
        statusBar.hide();
        return;
    }
    const name = path.basename(repo.rootUri.fsPath);
    if (status === 'ours') {
        statusBar.text = '$(shield) Secrets';
        statusBar.tooltip = `Code-Scrubber blocks commits that add secrets in "${name}". Click to remove the hook.`;
        statusBar.command = { command: 'twilight0963.codescrubber.removeHook', title: 'Remove hook', arguments: [repo.rootUri.fsPath] };
    } else {
        statusBar.text = '$(unlock) Secrets';
        statusBar.tooltip = `Commits in "${name}" are not checked for secrets. Click to install the Code-Scrubber pre-commit hook.`;
        statusBar.command = { command: 'twilight0963.codescrubber.installHook', title: 'Install hook', arguments: [repo.rootUri.fsPath] };
    }
    statusBar.show();
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activateHooks(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('twilight0963.codescrubber.installHook', repoRoot => installCommand(context, repoRoot)),
        vscode.commands.registerCommand('twilight0963.codescrubber.removeHook', repoRoot => removeCommand(context, repoRoot))
    );

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    context.subscriptions.push(statusBar, vscode.window.onDidChangeActiveTextEditor(updateStatusBar));

    gitApi = await getGitApi();
    if (!gitApi) return;

    const onRepo = repo => {
        offerHook(context, repo.rootUri.fsPath).catch(err =>
            console.error('Code-Scrubber: pre-commit hook setup failed', err));
        updateStatusBar();
    };
    gitApi.repositories.forEach(onRepo);
    context.subscriptions.push(
        gitApi.onDidOpenRepository(onRepo),
        gitApi.onDidCloseRepository(updateStatusBar)
    );
}

module.exports = {
    activateHooks,
    ensureRuntime,
    getGitApi
};
