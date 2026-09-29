const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const QUOTES = ['"', "'", '`'];

// The diagnostic covers the secret itself; widen it to the surrounding quotes.
// Returns null when the secret isn't a whole string literal (for example a
// password inside a connection string), since replacing it would break the code.
function literalRange(document, range) {
    if (range.start.line !== range.end.line || range.start.character === 0) {
        return null;
    }
    const lineText = document.lineAt(range.start.line).text;
    const before = lineText[range.start.character - 1];
    const after = lineText[range.end.character];
    if (!QUOTES.includes(before) || before !== after) {
        return null;
    }
    return new vscode.Range(range.start.translate(0, -1), range.end.translate(0, 1));
}

function createMoveToEnvAction(document, diagnostic) {
    // Path is considered as $cwd/.env
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return null;
    }

    const range = literalRange(document, diagnostic.range);
    if (!range) {
        return null;
    }
    const literal = document.getText(range);
    const credential = document.getText(diagnostic.range);

    const moveToEnv = new vscode.CodeAction("Move credential to .env and replace in file", vscode.CodeActionKind.QuickFix);
    moveToEnv.edit = new vscode.WorkspaceEdit();
    moveToEnv.diagnostics = [diagnostic];

    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const env_file = vscode.Uri.file(path.join(root, ".env"));
    moveToEnv.edit.createFile(env_file, { ignoreIfExists: true });

    const gitignore_path = path.join(root, ".gitignore");
    const gitignore_file = vscode.Uri.file(gitignore_path);
    moveToEnv.edit.createFile(gitignore_file, { ignoreIfExists: true });

    // Prefer the open (possibly unsaved) document, otherwise read from disk
    const gitignoreDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === gitignore_path);
    const gitignoreText = gitignoreDoc
        ? gitignoreDoc.getText()
        : (fs.existsSync(gitignore_path) ? fs.readFileSync(gitignore_path, 'utf8') : '');
    if (!gitignoreText.includes(".env")) {
        moveToEnv.edit.insert(gitignore_file, new vscode.Position(0, 0), ".env\n");
    }

    // Make key name
    const fileName = path.basename(document.fileName).toUpperCase();
    const keyName = "KEY_" + fileName.replace(/[^A-Z0-9]/g, "") + (diagnostic.range.start.line + 1);

    // Language map for env variable access
    const keyNameByLang = {
        python: `os.getenv("${keyName}")`,
        javascript: `process.env.${keyName}`,
        typescript: `process.env.${keyName}`,
        javascriptreact: `process.env.${keyName}`,
        typescriptreact: `process.env.${keyName}`,
        ruby: `ENV["${keyName}"]`,
        php: `getenv("${keyName}")`,
        go: `os.Getenv("${keyName}")`,
        java: `System.getenv("${keyName}")`,
        csharp: `Environment.GetEnvironmentVariable("${keyName}")`
    };

    const codeKeyName = keyNameByLang[document.languageId] || keyName; // Default to key name if language not in map

    const text = document.getText();
    const lang = document.languageId;

    // Add imports if not already present
    if (lang === "python") {
        let header = "";
        if (!/^\s*import os\b/m.test(text)) {
            header += "import os\n";
        }
        if (!text.includes("from dotenv import load_dotenv")) {
            header += "from dotenv import load_dotenv\nload_dotenv()\n";
        }
        if (header) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), header);
        }
    } else if (["javascript", "typescript", "javascriptreact", "typescriptreact"].includes(lang)) {
        if (!text.includes("require('dotenv')") && !text.includes('require("dotenv")') && !/dotenv\/config|from ["']dotenv["']/.test(text)) {
            // Match the file's module style
            const usesImports = /^\s*import\s/m.test(text);
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), usesImports ? "import 'dotenv/config';\n" : "require('dotenv').config();\n");
        }
    } else if (lang === "ruby") {
        if (!text.includes("require 'dotenv'")) {
            moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "require 'dotenv'\nDotenv.load\n");
        }
    } else if (lang === "php") {
        if (!text.includes("Dotenv\\Dotenv")) {
            const loader = "require 'vendor/autoload.php';\n$dotenv = Dotenv\\Dotenv::createImmutable(__DIR__);\n$dotenv->load();\n";
            if (text.startsWith("<?php")) {
                // Go after the existing opening tag instead of adding a second one
                moveToEnv.edit.insert(document.uri, new vscode.Position(1, 0), loader);
            } else {
                moveToEnv.edit.insert(document.uri, new vscode.Position(0, 0), "<?php\n" + loader + "?>\n");
            }
        }
    } else if (lang === "go") {
        // Imports must come after the package clause, and declarations after all imports
        const packageLine = document.getText().split("\n").findIndex(l => /^\s*package\s+\w+/.test(l));
        const importAt = new vscode.Position(packageLine >= 0 ? packageLine + 1 : 0, 0);
        let imports = "";
        if (!/"os"/.test(text)) {
            imports += "import \"os\"\n";
        }
        if (!text.includes("github.com/joho/godotenv")) {
            imports += "import \"github.com/joho/godotenv\"\n";
            moveToEnv.edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, "\n\nfunc init() { godotenv.Load() }\n");
        }
        if (imports) {
            moveToEnv.edit.insert(document.uri, importAt, "\n" + imports);
        }
    }

    // Add the secret to .env
    moveToEnv.edit.insert(env_file, new vscode.Position(0, 0), `${keyName}="${credential}"\n`);

    // Replace every copy of the literal with the env lookup
    let from = 0;
    let index;
    while ((index = text.indexOf(literal, from)) !== -1) {
        const occurrence = new vscode.Range(document.positionAt(index), document.positionAt(index + literal.length));
        moveToEnv.edit.replace(document.uri, occurrence, codeKeyName);
        from = index + literal.length;
    }

    return moveToEnv;
}

module.exports = {
    createMoveToEnvAction
};
