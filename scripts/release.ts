import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  marginRepository,
  parseReleaseManifest,
  validVersion,
  type ReleaseManifest,
} from "../shared/updates.ts";

const emptyManifest: ReleaseManifest = {
  schemaVersion: 1,
  latest: null,
  lastHighlightedVersion: null,
};
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function save(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
function requireRegularReleasePath(root: string, path: string) {
  // Refuse symlinked release directories/files, including broken links. Otherwise
  // the published tree could contain a link instead of the reviewed content.
  let current = realpathSync(root);
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Release paths must not be symbolic links.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
function manifestAt(root: string): ReleaseManifest {
  requireRegularReleasePath(root, join(root, "releases/stable.json"));
  return existsSync(join(root, "releases/stable.json"))
    ? parseReleaseManifest(json(join(root, "releases/stable.json")))
    : emptyManifest;
}
function clean(root: string) {
  if (git(root, "status", "--porcelain"))
    throw new Error(
      "Commit or preserve all working changes before preparing/finalizing a release. Nothing was discarded.",
    );
  if (git(root, "rev-parse", "--show-toplevel") !== realpathSync(root))
    throw new Error("Use the Margin repository root.");
  if (git(root, "branch", "--show-current") !== "main")
    throw new Error("Prepare official releases on main.");
  for (const operation of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ]) {
    if (
      existsSync(resolve(root, git(root, "rev-parse", "--git-path", operation)))
    )
      throw new Error("Finish the current Git operation first.");
  }
}
function validateNext(root: string, version: string) {
  if (!validVersion(version)) throw new Error("Use a stable x.y.z version.");
  for (const file of ["package.json", "package-lock.json"])
    requireRegularReleasePath(root, join(root, file));
  const current = json(join(root, "package.json")).version;
  if (
    !validVersion(current) ||
    compareVersions(version, current) <= 0 ||
    (manifestAt(root).latest &&
      compareVersions(version, manifestAt(root).latest!.version) <= 0)
  )
    throw new Error(
      "The new version must be newer than both source and published versions.",
    );
  if (git(root, "tag", "--list", `v${version}`))
    throw new Error(
      "Release tag already exists; published releases must not be rewritten.",
    );
}
interface Preparation {
  version: string;
  sourceCommit: string;
  previousCommit: string | null;
  manifest: ReleaseManifest;
}
function preparationPath(root: string, version: string) {
  return join(root, ".margin-data/releases", `${version}.json`);
}
export function prepareRelease(root: string, version: string) {
  clean(root);
  validateNext(root, version);
  const manifest = manifestAt(root);
  const sourceCommit = git(root, "rev-parse", "HEAD");
  if (manifest.latest)
    git(
      root,
      "merge-base",
      "--is-ancestor",
      manifest.latest.commit,
      sourceCommit,
    );
  const prep: Preparation = {
    version,
    sourceCommit,
    previousCommit: manifest.latest?.commit ?? null,
    manifest,
  };
  requireRegularReleasePath(root, join(root, "releases", version));
  save(preparationPath(root, version), prep);
  mkdirSync(join(root, "releases", version), { recursive: true });
  return `Release ${version} prepared at ${sourceCommit}.\n\nGive your coding agent this prompt:\n\nReview ${prep.previousCommit ? `all changes from commit ${prep.previousCommit} to commit ${sourceCommit}` : `the source tree at commit ${sourceCommit} and its history for this first published release (there is no previous release)`} in ${marginRepository}. Write user-facing release notes in releases/${version}/README.md. Explain features, fixes, security implications, breaking changes, known limitations, and upgrade/restart requirements. Separate verified facts from assumptions; do not invent test results or security claims. Include only useful, real screenshots/images captured from disposable data, with no private information; store them under releases/${version}/ and use relative image links. Do not change application source while preparing these notes. Ask me to review the notes and images, then commit the reviewed files.\n\nAfter reviewing and committing the notes:\n  bash scripts/release.sh finalize ${version}\n\nIf application code changes, run prepare again and update the notes before finalizing. No release has been published.`;
}
export function validateReleaseNotes(root: string, version: string) {
  const directory = join(root, "releases", version);
  const path = join(directory, "README.md");
  requireRegularReleasePath(root, path);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink())
    throw new Error(
      "Add reviewed release notes at releases/VERSION/README.md.",
    );
  git(root, "ls-files", "--error-unmatch", "--", relative(root, path));
  const notes = readFileSync(path, "utf8");
  if (
    notes.trim().length < 40 ||
    !/^#\s+\S/m.test(notes) ||
    /\b(?:TODO|TBD|PLACEHOLDER)\b/.test(notes)
  )
    throw new Error(
      "Release notes need a heading, substantive content, and no placeholders.",
    );
  const imageReferences = [
    ...[
      ...notes.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
    ].map((m) => m[1]),
  ];
  for (const match of notes.matchAll(/<img\b[^>]*>/gi)) {
    const src = match[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!src || /\bsrcset\s*=/i.test(match[0]))
      throw new Error(
        "Use a quoted, single local src for release-note images.",
      );
    imageReferences.push(src[1]);
  }
  // Reference-style images require a resolvable local definition too.
  for (const match of notes.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?(?!\()/g)) {
    const key = (match[2] || match[1]).toLowerCase();
    const definition = [
      ...notes.matchAll(/^\s*\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm),
    ].find((m) => m[1].toLowerCase() === key);
    if (!definition)
      throw new Error("Unresolved release-note image reference.");
    imageReferences.push(definition[2]);
  }
  for (const ref of imageReferences) {
    const image = resolve(directory, decodeURIComponent(ref.split(/[?#]/)[0]));
    if (
      /^[a-z]+:/i.test(ref) ||
      isAbsolute(ref) ||
      !/\.(png|jpe?g|gif|webp)$/i.test(image) ||
      !existsSync(image) ||
      !lstatSync(image).isFile() ||
      !realpathSync(image).startsWith(realpathSync(directory) + sep)
    )
      throw new Error(
        `Image must be an existing bundled PNG/JPEG/GIF/WebP inside this release: ${ref}`,
      );
    git(root, "ls-files", "--error-unmatch", "--", relative(root, image));
  }
  return notes;
}
function fingerprint(root: string) {
  const hash = createHash("sha256");
  hash.update(git(root, "rev-parse", "HEAD"));
  hash.update(git(root, "diff", "--cached", "--binary"));
  for (const name of execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort()) {
    hash.update(name + "\0");
    try {
      const path = join(root, name),
        stat = lstatSync(path);
      hash.update(String(stat.mode) + "\0");
      hash.update(
        stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
  }
  return hash.digest("hex");
}
export function finalizeRelease(
  root: string,
  version: string,
  options: {
    highlighted: boolean;
    security?: boolean;
    skipTestsReason?: string;
    runTests?: () => void;
  },
) {
  clean(root);
  validateNext(root, version);
  const prep = json(preparationPath(root, version)) as Preparation;
  if (prep.version !== version) throw new Error("Invalid release preparation.");
  const changed = git(root, "diff", "--name-only", prep.sourceCommit, "HEAD")
    .split("\n")
    .filter(Boolean);
  git(root, "merge-base", "--is-ancestor", prep.sourceCommit, "HEAD");
  if (
    changed.some((path) => !path.startsWith(`releases/${version}/`)) ||
    JSON.stringify(manifestAt(root)) !== JSON.stringify(prep.manifest)
  )
    throw new Error(
      "Release preparation is stale: code or published metadata changed. Prepare again and review the updated notes.",
    );
  validateReleaseNotes(root, version);
  if (
    options.skipTestsReason !== undefined &&
    (!options.skipTestsReason.trim() || options.skipTestsReason.length > 500)
  )
    throw new Error(
      "Skipping tests requires a short reason (1–500 characters).",
    );
  const packagePath = join(root, "package.json"),
    lockPath = join(root, "package-lock.json");
  const pkg = json(packagePath),
    lock = json(lockPath);
  if (
    !lock.packages?.[""] ||
    lock.version !== pkg.version ||
    lock.packages[""].version !== pkg.version
  )
    throw new Error("Package and lockfile versions disagree.");
  // Test the exact candidate version. On failure leave changes for inspection,
  // never reset the maintainer's checkout or publish a success manifest.
  pkg.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  save(packagePath, pkg);
  save(lockPath, lock);
  const beforeTests = fingerprint(root);
  if (options.skipTestsReason === undefined) {
    (
      options.runTests ??
      (() => {
        const result = spawnSync("npm", ["run", "test:release"], {
          cwd: root,
          stdio: "inherit",
        });
        if (result.status !== 0)
          throw new Error(
            "Release tests failed. No release/tag/feed was created. Inspect the candidate version edits; restore only those edits before retrying.",
          );
      })
    )();
  }
  if (fingerprint(root) !== beforeTests)
    throw new Error(
      "Candidate files changed during testing. No release was created; review and prepare again.",
    );
  git(root, "add", "--", "package.json", "package-lock.json");
  const testedTree = git(root, "write-tree");
  git(root, "commit", "-m", `Release ${version}`);
  const commit = git(root, "rev-parse", "HEAD");
  if (
    git(root, "rev-parse", "HEAD^{tree}") !== testedTree ||
    git(root, "status", "--porcelain")
  )
    throw new Error(
      "A commit hook changed the tested candidate. No tag/feed was created; inspect the new commit before retrying.",
    );
  git(root, "tag", "-a", `v${version}`, "-m", `Margin ${version}`);
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    latest: {
      version,
      commit,
      tag: `v${version}`,
      highlighted: options.highlighted,
      security: !!options.security,
      publishedAt: new Date().toISOString(),
      tests:
        options.skipTestsReason === undefined
          ? { status: "passed" }
          : { status: "skipped", reason: options.skipTestsReason.trim() },
    },
    lastHighlightedVersion: options.highlighted
      ? version
      : prep.manifest.lastHighlightedVersion,
  };
  save(join(root, "releases/stable.json"), parseReleaseManifest(manifest));
  git(root, "add", "--", "releases/stable.json");
  git(
    root,
    "commit",
    "-m",
    `Advertise release ${version}${options.highlighted ? " (highlighted)" : " (Settings only)"}`,
  );
  return manifest;
}
async function ask(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
export async function main(args = process.argv.slice(2)) {
  const root = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const [action, version, ...flags] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(
      "Usage: bash scripts/release.sh prepare VERSION\n       bash scripts/release.sh finalize VERSION [--highlighted|--quiet] [--security] [--skip-tests REASON]\n\nprepare prints an agent prompt; finalize creates LOCAL commits/tag only. Review notes first. Tests default to running; skipping is recorded. Noninteractive finalization requires --quiet or --highlighted. Publishing remains explicit.",
    );
    return;
  }
  if (!["prepare", "finalize"].includes(action) || !validVersion(version))
    throw new Error(
      "Expected prepare/finalize and a stable x.y.z version. Use --help.",
    );
  let highlighted: boolean | undefined,
    security = false,
    skipTestsReason: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--highlighted" || flags[i] === "--quiet") {
      if (highlighted !== undefined)
        throw new Error("Choose one notification mode.");
      highlighted = flags[i] === "--highlighted";
    } else if (flags[i] === "--security") security = true;
    else if (
      flags[i] === "--skip-tests" &&
      flags[i + 1] &&
      !flags[i + 1].startsWith("--")
    )
      skipTestsReason = flags[++i];
    else throw new Error(`Unknown or incomplete option: ${flags[i]}`);
  }
  if (action === "prepare" && flags.length)
    throw new Error("Release options belong to finalize.");
  const lock = resolve(
    root,
    git(root, "rev-parse", "--git-path", "margin-release.lock"),
  );
  writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
  try {
    if (action === "prepare") {
      console.log(prepareRelease(root, version));
      return;
    }
    if (highlighted === undefined) {
      if (!process.stdin.isTTY)
        throw new Error(
          "Choose --quiet or --highlighted for noninteractive finalization.",
        );
      highlighted = /^y(es)?$/i.test(
        await ask(
          "Highlight this release in the main interface? Settings only otherwise. [y/N] ",
        ),
      );
    }
    if (skipTestsReason === undefined && process.stdin.isTTY) {
      const answer = await ask(
        "Run the recommended full release regression battery now? [Y/n] ",
      );
      if (/^n(o)?$/i.test(answer)) {
        skipTestsReason = await ask(
          "Reason for skipping (recorded in release metadata): ",
        );
        if (!skipTestsReason) throw new Error("Skipping requires a reason.");
      }
    }
    const manifest = finalizeRelease(root, version, {
      highlighted,
      security,
      skipTestsReason,
    });
    console.log(
      `\nPrepared LOCAL release ${version} at ${manifest.latest!.commit}. Nothing pushed.\nReview commits, notes, images, and test results, then explicitly publish source + tag together:\n  git push --atomic ${marginRepository}.git main refs/tags/v${version}\n\nDo not force-push or move release tags. If interrupted, inspect git log/status/tags before retrying.`,
    );
  } finally {
    rmSync(lock);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
