# Change Log

All notable changes to the "code-scrubber" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2.0.3] - 2026-10-07

### Added

- **Supabase keys:**
  - Secret keys (`sb_secret_…`) are reported with **high** confidence.
  - Legacy JWT keys are recognised by their `role` claim: `service_role` keys, which bypass Row Level Security, are **high** confidence; `anon` keys are **low**, since they are meant to ship in client code.
  - Publishable keys (`sb_publishable_…`) are reported with **low** confidence.
- C/C++ headers (`.h`, `.hpp`), precompiled headers and more binary formats (`.a`, `.lib`, `.obj`, `.wasm`, `.node`, `.pdb`) are no longer scanned.

### Changed

- When findings overlap, a known credential format now wins over the generic rules even if it has lower confidence. For example, `apiKey: "<Supabase anon key>"` is reported as a low-confidence anon key instead of a medium-confidence secret assignment.

### Fixed

- JSON Web Tokens made only of letters and digits were mistaken for dotted identifiers (like `com.example.app`) and not reported.
- Fewer false positives:
  - Versioned package specifiers such as `@radix-ui/react-slot@1.1.2`.
  - Firebase app IDs and Google OAuth client IDs, found in `google-services.json`, `GoogleService-Info.plist` and `firebase_options.dart`.

## [2.0.1] - 2026-10-05

### Added

- Extension icon, and a matching dark banner for the Marketplace page.

## [2.0.0] - 2026-10-01

### ⚠️ Breaking changes

- **New `.env.enc` encryption format.** Encrypted `.env` files now use AES-256-GCM with a random salt per file, replacing AES-256-CBC with a fixed salt. A wrong password or a modified file is now detected instead of producing garbage.

  **Files encrypted with 1.x cannot be decrypted by 2.0.0**, and there is no automatic conversion. Before upgrading, run _Decrypt .env.enc file_ in 1.x, then encrypt again after upgrading.

  If you already upgraded, run this in the folder containing `.env.enc` (replace `your-password`) to recover your `.env`, then encrypt it again:

  ```sh
  CODE_SCRUBBER_PASSWORD='your-password' node -e "const c=require('crypto'),fs=require('fs');const [iv,ct]=fs.readFileSync('.env.enc','utf8').trim().split(':');const d=c.createDecipheriv('aes-256-cbc',c.scryptSync(process.env.CODE_SCRUBBER_PASSWORD,'salt',32),Buffer.from(iv,'hex'));fs.writeFileSync('.env',Buffer.concat([d.update(ct,'hex'),d.final()]),{mode:0o600})"
  ```

  Setting the password inline saves it in your shell history.

### Added

- **Pre-commit hook** that blocks commits adding secrets. Only the lines a commit adds are checked, so existing code doesn't block unrelated commits.
  - Installed automatically in each repository you open. It never overwrites an existing hook. The new `twilight0963.codescrubber.preCommitHook` setting picks `always` (default), `prompt` or `never`.
  - Commits made from VS Code or another app can be pushed through with **Commit Anyway** in a dialog. Every override is logged, with secrets masked, in `.git/code-scrubber-overrides.log`.
  - New commands: **Install pre-commit hook** and **Remove pre-commit hook**.
  - A status bar item shows whether the current repository is protected. Click it to install or remove the hook.
  - Also works with the [pre-commit](https://pre-commit.com) framework.
- **Scan repository for secrets** command, also a 🔍 button in the Source Control view. It scans every file, including ones that aren't open, and the git history. It also runs after the hook is installed.
  - Secrets found in history show the commit that introduced them and whether they are still in the code.
  - A key found in history that is no longer in the code or any `.env` file is treated as rotated: the scan shows _"Key AKIA…XYZ was successfully rotated!"_ instead of a warning.
  - If the repository has an encrypted `.env.enc`, the history scan stops and asks you to decrypt it first, since otherwise there's no way to tell whether a leaked key is still in use.
- **Command line tool** (`code-scrubber`) that works without VS Code:
  - `scan` (files), `staged` (what you're about to commit), `history` (every commit, or a `--range`) and `install-hook`.
  - Text, JSON and SARIF 2.1.0 output, for GitHub code scanning and other tools.
  - `--fail-on` sets the lowest confidence that fails the command. Exit codes: `0` nothing blocking, `1` blocking findings, `2` error.
- **New detection engine:**
  - 18 known credential formats: AWS, GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, SendGrid, Twilio and npm keys, private keys, JSON Web Tokens, passwords in database connection strings, and `password = "..."`-style assignments.
  - Shannon entropy scoring for random-looking strings that match no known format.
  - Filters for common false positives: placeholders, hashes, UUIDs, file paths, URLs and version numbers.
  - Each finding has a confidence level: **high** (known format), **medium** (secret-like assignment) or **low** (entropy only).
- **More ways to handle false positives:**
  - A `code-scrubber:ignore` comment on the line, or `code-scrubber:ignore-next-line` on the line above. Also available as a quick fix.
  - A `.code-scrubber.json` config file in the repository root, with `failOn`, `exclude` and an `allowlist` of paths, rules and values.
  - A baseline of accepted findings (`--update-baseline`), so only new ones are reported. It stores only a hash of each secret.
- Files are scanned when they are opened, not only when saved. Problems are cleared when a file is closed.

### Changed

- Secrets are masked in the Problems panel and in all reports (for example `AKIA…BZP`), so they're never shown in full.
- Problems are reported as errors or warnings depending on confidence, instead of information.
- Quick fixes only appear on lines where Code-Scrubber reported a problem.
- **Move credential to .env:**
  - Only replaces the secret when it's a whole string literal, so it no longer breaks code like connection strings.
  - Writes the value to `.env` in quotes.
  - Adds the dotenv import in the file's existing style (`import` or `require`) and supports React files (`.jsx`, `.tsx`).
  - Places PHP and Go loader code correctly.
- The ignore-file quick fix uses the right comment syntax for more languages, and is not offered for files that can't contain comments, such as JSON.
- Decrypted `.env` files are created readable only by you.
- License changed from GPL-3.0 to MIT.

### Removed

- The **Upload to AWS Secrets Manager** quick fix, which wasn't implemented yet. It will come back once it works.

## [1.0.0] - 2026-04-08

- Initial release.
