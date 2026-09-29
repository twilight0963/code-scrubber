const vscode = require('vscode');

// Map comment syntax by language to not affect code: [start, end]
const commentSyntax = {
    'python': ['#', ''],
    'ruby': ['#', ''],
    'perl': ['#', ''],
    'shellscript': ['#', ''],
    'powershell': ['#', ''],
    'yaml': ['#', ''],
    'toml': ['#', ''],
    'properties': ['#', ''],
    'dockerfile': ['#', ''],
    'makefile': ['#', ''],
    'r': ['#', ''],
    'elixir': ['#', ''],
    'dotenv': ['#', ''],
    'ini': [';', ''],
    'assembly': [';', ''],
    'sql': ['--', ''],
    'lua': ['--', ''],
    'haskell': ['--', ''],
    'html': ['<!--', ' -->'],
    'xml': ['<!--', ' -->'],
    'markdown': ['<!--', ' -->'],
    'css': ['/*', ' */'],
    'default': ['//', '']
};

// Languages with no comment syntax at all
const noComments = ['json', 'plaintext'];

function comment(document, text) {
    if (noComments.includes(document.languageId)) {
        return null;
    }
    const [start, end] = commentSyntax[document.languageId] || commentSyntax['default'];
    return `${start} ${text}${end}`;
}

function createIgnoreAction(document) {
    const text = comment(document, 'ignore.code-scrubber.diagnostics');
    if (!text) {
        return null;
    }
    const ignoreAction = new vscode.CodeAction("Ignore credential leaks for this file. (Not Recommended)", vscode.CodeActionKind.QuickFix);
    ignoreAction.edit = new vscode.WorkspaceEdit();
    // Add ignore code to the start of the code
    ignoreAction.edit.insert(document.uri, new vscode.Position(0, 0), text + '\n');

    return ignoreAction;
}

// Suppress one finding by adding a comment at the end of its line
function createIgnoreLineAction(document, diagnostic) {
    const text = comment(document, 'code-scrubber:ignore');
    if (!text) {
        return null;
    }
    const line = document.lineAt(diagnostic.range.start.line);
    const ignoreLine = new vscode.CodeAction("Ignore this finding (false positive)", vscode.CodeActionKind.QuickFix);
    ignoreLine.edit = new vscode.WorkspaceEdit();
    ignoreLine.edit.insert(document.uri, line.range.end, ' ' + text);
    ignoreLine.diagnostics = [diagnostic];

    return ignoreLine;
}

module.exports = {
    createIgnoreAction,
    createIgnoreLineAction
};
