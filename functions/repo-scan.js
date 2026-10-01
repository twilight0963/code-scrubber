const vscode = require('vscode');
const path = require('path');
const { scanRepository, ENCRYPTED_ENV_MESSAGE } = require('../cli');
const { toDiagnostic } = require('./credential-scanner');

let diagnosticCollection = null;
let output = null;

/**
 * @param {vscode.ExtensionContext} context
 * @param {vscode.DiagnosticCollection} collection  The same collection the editor scanner uses
 */
function init(context, collection) {
    diagnosticCollection = collection;
    output = vscode.window.createOutputChannel('Code-Scrubber');
    context.subscriptions.push(output);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function showProblems() {
    vscode.commands.executeCommand('workbench.actions.view.problems');
}

// Secrets that only exist in history can't be shown as problems, so they are
// listed (masked) in the Code-Scrubber output channel.
function writeHistoryReport(name, history) {
    output.clear();
    output.appendLine(`Code-Scrubber: secrets found in the git history of "${name}"`);
    output.appendLine('');
    for (const h of history) {
        const where = `${h.file}:${h.line + 1}`;
        const status = h.status === 'history-only'
            ? 'deleted from the code, but still in git history'
            : 'still in the code';
        output.appendLine(`${h.confidence.toUpperCase().padEnd(6)}  ${where}  ${h.ruleName}  ${h.masked}`);
        output.appendLine(`        introduced in ${h.commit.sha.slice(0, 10)} (${h.commit.date.slice(0, 10)}, ${h.commit.author}); ${status}`);
    }
    output.appendLine('');
    output.appendLine('Removing a secret from the code does not remove it from git history, or from any');
    output.appendLine('clone or fork. For each credential above:');
    output.appendLine('  1. Revoke or rotate it with the provider, and issue a new one.');
    output.appendLine('  2. Load the new value from an environment variable or a secret manager.');
    output.appendLine('  3. Optionally scrub history (git filter-repo / BFG). This is cleanup, not the fix.');
}

/**
 * Scan a repository and report the results.
 * @param {string} repoRoot
 * @param {{ history?: boolean, automatic?: boolean }} options
 *   automatic: run right after the hook was installed; stays quiet when nothing is found
 * @returns {Promise<{ files: number, filesWithSecrets: number, historyOnly: number, cancelled: boolean }>}
 */
async function scan(repoRoot, { history = true, automatic = false } = {}) {
    const name = path.basename(repoRoot);
    const controller = new AbortController();

    let result;
    try {
        result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Code-Scrubber: scanning "${name}" for secrets…`,
            cancellable: true
        }, (_progress, token) => {
            token.onCancellationRequested(() => controller.abort());
            return scanRepository(repoRoot, { history, signal: controller.signal });
        });
    } catch (err) {
        if (err.code !== 'ENCRYPTED_ENV') throw err;
        // Can't tell whether leaked keys were rotated without reading the .env
        vscode.window.showWarningMessage(`${ENCRYPTED_ENV_MESSAGE}.`);
        return { files: 0, filesWithSecrets: 0, historyOnly: 0, cancelled: true };
    }

    // Show file findings in the Problems panel, including files that aren't open
    const byFile = new Map();
    for (const f of result.files) {
        const uri = vscode.Uri.file(path.join(repoRoot, f.file));
        if (!byFile.has(uri.fsPath)) byFile.set(uri.fsPath, { uri, diagnostics: [] });
        byFile.get(uri.fsPath).diagnostics.push(toDiagnostic(f));
    }
    for (const { uri, diagnostics } of byFile.values()) {
        diagnosticCollection.set(uri, diagnostics);
    }

    const historyOnly = result.history.filter(h => h.status === 'history-only');
    if (historyOnly.length > 0) writeHistoryReport(name, result.history);

    const summary = {
        files: result.files.length,
        filesWithSecrets: byFile.size,
        historyOnly: historyOnly.length,
        cancelled: result.cancelled
    };

    // Messages are not awaited: nobody may ever click them, and the scan is done
    if (result.cancelled) {
        vscode.window.showInformationMessage(`Code-Scrubber: the scan of "${name}" was cancelled.`);
        return summary;
    }
    if (summary.files > 0) {
        const message = automatic
            ? `Potential secrets were found in "${name}": ${plural(summary.files, 'finding')} in ${plural(summary.filesWithSecrets, 'file')}. Review them before committing.`
            : `Code-Scrubber found ${plural(summary.files, 'potential secret')} in ${plural(summary.filesWithSecrets, 'file')} in "${name}".`;
        vscode.window.showWarningMessage(message, 'Show Problems').then(pick => {
            if (pick === 'Show Problems') showProblems();
        });
    }
    if (summary.historyOnly > 0) {
        vscode.window.showWarningMessage(
            `${plural(summary.historyOnly, 'secret')} ${summary.historyOnly === 1 ? 'was' : 'were'} found in the git history of "${name}". Removing a secret from the code does not remove it from history; the affected credentials should be rotated.`,
            'View Details'
        ).then(pick => {
            if (pick === 'View Details') output.show(true);
        });
    }
    // Leaked keys that are gone from the code and .env were rotated; not a problem
    if (result.rotated.length === 1) {
        vscode.window.showInformationMessage(`Key ${result.rotated[0].masked} was successfully rotated!`);
    } else if (result.rotated.length > 1) {
        const keys = result.rotated.map(r => r.masked).join(', ');
        vscode.window.showInformationMessage(`${result.rotated.length} keys found in the git history of "${name}" were successfully rotated: ${keys}`);
    }
    if (!automatic && summary.files === 0 && summary.historyOnly === 0) {
        vscode.window.showInformationMessage(`No potential secrets were found in "${name}".`);
    }
    return summary;
}

module.exports = {
    init,
    scan
};
