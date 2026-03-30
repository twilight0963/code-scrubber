const vscode = require('vscode');

function createIgnoreAction(document) {
    const ignoreAction = new vscode.CodeAction("Ignore credential leaks for this file. (Not Recommended)", vscode.CodeActionKind.QuickFix);
    ignoreAction.edit = new vscode.WorkspaceEdit();
    
    // Map comment character by language to not affect code, and grab it
    const commentCharacters = {
        'python': '#',
        'assembly': ';',
        'html': '<!--',
        'css': '/*',
        'ruby': '#',
        'perl': '#',
        'default': '//'
    };
    
    const commentChar = commentCharacters[document.languageId] || commentCharacters['default'];
    // Add ignore code to the start of the code
    ignoreAction.edit.insert(document.uri, new vscode.Position(0, 0), commentChar + ' ignore.code-scrubber.diagnostics\n');
    
    return ignoreAction;
}

module.exports = {
    createIgnoreAction
};
