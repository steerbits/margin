If you want to create temporary files or folders isolated from git, you should use .margin-data/temporary/ folder to put files as it is in .gitigore. Create new subfolders within temporary so that it is properly organized.

## Tests and releases

- Add regression coverage for new behavior and bug fixes. Use existing suites where possible; their file patterns discover new tests automatically.
- Register genuinely new automated suites in `scripts/release-suites.ts`, the single registry behind `npm run test:release`.
- During feature development, run focused tests and relevant checks. The full release battery is not required for every change.
- Before a release, recommend the full battery. The release script asks once and allows an explicit skip reason. Report skipped checks and failures honestly; never describe unrun checks as passed.
- Release builds/tests use disposable data and source copies, not the running installation's build or credentials. Real OS-sandbox and live-provider checks are separately identified manual checks.
- Follow `docs/releases.md` for reviewed notes/images, independent `highlighted` metadata, pinned release commits, and explicit publishing. Never publish or move release tags as a side effect of ordinary feature development.