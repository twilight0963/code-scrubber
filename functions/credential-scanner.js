const vscode = require('vscode')
const core = require('../core')

// Shown as the "source" of each problem; quick fixes use it to find our diagnostics.
const DIAGNOSTIC_SOURCE = 'Code-Scrubber'

const SEVERITY = {
    high: vscode.DiagnosticSeverity.Error,
    medium: vscode.DiagnosticSeverity.Warning,
    low: vscode.DiagnosticSeverity.Warning
}

// The actual detection system
function detectCredentials(document, diagnosticCollection) {
    // Assume no problems until found
    diagnosticCollection.delete(document.uri)
    // Only scan real files, not output panels, git diffs etc.
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
        return;
    }
    // Ignore .env since thats the good practice
    if (/(?:^|[\\/])\.env(?:\.[\w-]+)?$/.test(document.fileName) && !document.fileName.endsWith('.example')) {
        return;
    }
    if (document.fileName.endsWith(".gitignore")) {
        const hasEnv = document.getText().includes(".env");
        if (!hasEnv) {
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(0, 0)
            );
            const diagnostic = new vscode.Diagnostic(range, `Best practice: .env file should be added to .gitignore to avoid accidentally committing secrets.`, vscode.DiagnosticSeverity.Warning);
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = 'gitignore-missing-env';
            diagnosticCollection.set(document.uri, [diagnostic]);
        }
        return;
    }

    const findings = core.scanText(document.getText(), { filePath: document.fileName })

    // List of found problems
    const diagnostics = findings.map(finding => {
        const range = new vscode.Range(
            new vscode.Position(finding.line, finding.column),
            new vscode.Position(finding.endLine, finding.endColumn)
        );
        // Mask the secret so it doesn't end up in the Problems panel or logs
        const diagnostic = new vscode.Diagnostic(range, `${finding.ruleName} detected: ${finding.masked}`, SEVERITY[finding.confidence]);
        diagnostic.source = DIAGNOSTIC_SOURCE;
        diagnostic.code = finding.ruleId;
        return diagnostic;
    });

    // Update the problems tab
    if (diagnostics.length > 0) {
        diagnosticCollection.set(document.uri, diagnostics);
    }
}

module.exports = {
    detectCredentials,
    DIAGNOSTIC_SOURCE
}
