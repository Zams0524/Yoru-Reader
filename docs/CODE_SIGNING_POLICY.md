# Code signing policy

**Status: pending.** Yoru Reader has applied for free code signing from the SignPath Foundation. Until the application is approved, Windows releases are unsigned and Windows SmartScreen shows "Unknown publisher".

Once approved:

> Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

| Platform | Artifact | Signing |
| :--- | :--- | :--- |
| Windows | `Yoru-Reader.Setup.exe` and the application executable inside it | SignPath Foundation (pending) |
| Android | `Yoru-Reader.apk` | Project's own APK signing key |
| macOS | `.dmg` | Not signed |
| Linux | `.flatpak` | Not signed |

## Build and signing process

- Every Windows release is built by [GitHub Actions](../.github/workflows/build-all-releases.yml) from the public source in this repository. Binaries built on a developer machine are never signed.
- The bundled reader extension is built in the same workflow from its public source, the [`yoru` branch of Zams0524/JitenReader](https://github.com/Zams0524/JitenReader/tree/yoru), at the tag pinned in [`build/reader-ext.json`](../build/reader-ext.json).
- Each signing request is approved manually by an approver (see below) before the signed file is published.
- The signing key is held by SignPath in a hardware security module; the project never has access to it.
- Signed binaries are published only on the [GitHub Releases page](https://github.com/Zams0524/Yoru-Reader/releases).

## Team roles

| Role | Members |
| :--- | :--- |
| Authors (may change source code without further review) | [@Zams0524](https://github.com/Zams0524) |
| Reviewers (review changes from contributors who are not authors) | [@Zams0524](https://github.com/Zams0524) |
| Approvers (approve each signing request) | [@Zams0524](https://github.com/Zams0524) |

All members use multi-factor authentication for GitHub and SignPath.

## Privacy policy

See [PRIVACY.md](PRIVACY.md). In short: Yoru Reader does not collect analytics or telemetry. It only contacts other services for features the user turns on or triggers, and those are listed there.

## Reporting a problem

If a signed Yoru Reader binary behaves maliciously or looks tampered with, do not run it. Open an issue at <https://github.com/Zams0524/Yoru-Reader/issues> with the file's SHA-256 hash and where you downloaded it.
