const vscode = require('vscode');

function createUploadToAwsAction(document, range) {
    const uploadToAws = new vscode.CodeAction("Upload credential to AWS Secrets Manager and replace in file.", vscode.CodeActionKind.QuickFix);
    return uploadToAws;
}

module.exports = {
    createUploadToAwsAction
};
