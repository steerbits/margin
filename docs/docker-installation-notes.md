# Docker installation: notes for a future implementation

Docker support is deferred from the initial native installer. These notes preserve the tested direction for a user or coding agent who later wants a Docker version.

## What was tested

On Docker Desktop with a Linux arm64 container, Node 24.21.0, Pi 0.85.1, and cco revision `42fc44e5ecc0e26ef9068743b52485ebbcd54cf9`:

- All 189 Node tests passed.
- Real bubblewrap enforcement blocked writes outside the selected workspace, including symlink writes and deletion by a child process.
- The browser displayed a fresh provider setup screen, created a workspace, and saved notes.
- Browser authentication, workspace identity, and notes survived replacing the container while reusing its data volume.
- The provider callback port was reachable from the host. A real vendor login/token refresh/model request was not part of the automated verification.

The trial container and its data volume were later removed at the owner's request, after their data and container home were archived. Docker Desktop and unrelated Docker resources were retained.

## Why Docker needs additional setup

The default Docker seccomp profile blocked bubblewrap's namespace setup. The trial used a pinned copy of Docker's upstream default profile with six additional allowed syscalls: `clone`, `unshare`, `mount`, `umount2`, `pivot_root`, and `setns`. The container remained non-root, dropped all host capabilities, enabled no-new-privileges, and retained seccomp filtering. No host folders or Docker socket were mounted.

This is a deliberate container-specific policy, not evidence that bubblewrap works in every Docker configuration. Test it on the intended host. Do not use privileged mode, disable the whole seccomp profile, or replace cco with an unrestricted shim merely to make startup pass. [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/).

The original recipes remain in the local experiment folders. This source release keeps Docker as documentation rather than a shipped installer mode. An agent adapting it should create a dedicated Dockerfile, entrypoint, and Compose definition from the tested design below. The policy base was moby/profiles commit 61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31, seccomp/default.json; retain its license and record any changes.

## Application changes to evaluate

1. Include Linux Node, Git, bubblewrap, CA certificates, Bash, and required utilities in a versioned image. Install npm dependencies from the lockfile.
2. Run the entire workspace worker through bundled cco with the native Linux backend. Preserve ownership checks, filesystem grants, and shutdown behavior.
3. Use a persistent volume for application source/customizations, Margin data, Pi configuration, and projects. Keep stable container paths across restarts.
4. Bind the gateway to a container-reachable interface while publishing its host port only on localhost for a local trial. Keep Host/Origin checking aligned with the published port.
5. Use a distinct browser cookie for another local installation. Browser cookies are shared across ports on the same hostname.
6. Replace the Mac folder dialog with a browser flow that creates/selects container workspaces.
7. For browser Codex login, Pi's existing `PI_OAUTH_CALLBACK_HOST` can select the callback binding; publish the callback port on host loopback. Device-code login is another option.
8. Design routing for generated app/artifact preview ports. Publishing only the main application port does not make arbitrary container localhost previews accessible from the Mac browser.

In the trial, the process ran as Linux user `node`, so its home was `/home/node`. That was correct when asked for its home directory. Workspaces were under `/data/workspaces`, saved Margin data under `/data/state`, and Pi configuration under `/data/state/pi`. Moving Pi configuration does not rename the operating-system user's home.

## Instructions for an agent adapting this

Start with a new image and disposable volume. Keep the owner's existing app, files, and credentials untouched. Run the real sandbox probe, the relevant app tests, browser onboarding, and a container-replacement persistence check. Do not import the owner's real state to validate initial packaging.

Record the effective architecture explicitly: this host had a global amd64 Docker default despite an arm64 Docker Desktop engine. The successful trial selected Linux arm64 explicitly.

Treat the reference as an experiment. It has no general updater: its first-run source seeding preserves customized source on subsequent starts. An image rebuild does not automatically replace that source. Preserve that behavior intentionally or design and test an explicit upgrade path.
