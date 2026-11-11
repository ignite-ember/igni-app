# Verifying an igni app release

Every igni app release on GitHub carries the evidence to check it: what is in
it, that its files are the ones this repository's release workflow built, and
— once the release key exists — a signature from Ignite Ember.

This page covers the desktop app's own artifacts. igni-core has the same page
for the wheel and the sdist, and igni-sdk for the SDK packages; the commands
are the same in all three, with the repository and the tag changed. The
general version, with the air-gapped procedure and the signing details, is
[igni-core's page](https://github.com/ignite-ember/igni-core/blob/main/docs/VERIFYING_RELEASES.md).

## What is on a release

| File | What it is |
|---|---|
| the installers | `.dmg` (macOS), `.msi` (Windows), `.AppImage` (Linux) |
| `igni_aarch64.app.tar.gz` | the macOS updater payload — the signed, notarized `.app`, as the installed app downloads it |
| `igni_aarch64.app.tar.gz.sig` | the minisign signature over that payload |
| `latest.json` | what the updater reads: the payload's URL, its signature and the version |
| `SHA256SUMS` | the SHA-256 of every other file on the release, SBOMs included |
| `SHA256SUMS.sig` | a cosign signature over `SHA256SUMS`. **Absent until the key ceremony has happened** |
| `igni-1.0.4.provenance.sigstore.json` | the build-provenance attestation for every file in `SHA256SUMS`, as a Sigstore bundle, for offline verification |
| `igni-desktop-1.0.4.cdx.json` | the CycloneDX SBOM of the desktop app: the Tauri shell's crates and the web UI's npm packages |

The backend the app installs on first launch (`igni-core==1.0.4`) is **not**
on this release — it is released from
[igni-core](https://github.com/ignite-ember/igni-core/releases), and has its
own checksums, SBOM and provenance. The desktop SBOM covers the app; the
backend's is the one in igni-core's release.

To scan the desktop SBOM: `trivy sbom igni-desktop-1.0.4.cdx.json`, or
`grype sbom:igni-desktop-1.0.4.cdx.json`.

## 1. Checksums

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

Every file you downloaded must say `OK`. This is only as good as the
`SHA256SUMS` you checked against, which is what the next step is for.

## 2. Build provenance (online)

Each file has a SLSA build-provenance attestation, made by GitHub Actions in
the run that built it and signed with a short-lived Sigstore certificate that
names this repository, the workflow and the commit. It needs the GitHub CLI
(`gh` 2.49 or later):

```bash
gh attestation verify igni-desktop-installer.dmg \
  --repo ignite-ember/igni-app
```

To also insist on the workflow and the tag that built it:

```bash
gh attestation verify igni-desktop-installer.dmg \
  --repo ignite-ember/igni-app \
  --signer-workflow ignite-ember/igni-app/.github/workflows/release.yml \
  --source-ref refs/tags/v1.0.4
```

Every file at once:

```bash
while read -r _ file; do
  [ -f "$file" ] && gh attestation verify "$file" --repo ignite-ember/igni-app >/dev/null && echo "OK  $file"
done < SHA256SUMS
```

A pass means the file is byte-for-byte what that workflow produced from that
commit. It does not mean the commit is free of bugs; that is what the SBOM
and the advisories are for.

## 3. Build provenance on an air-gapped machine

Verification needs no network if you bring two things with you: the
attestation bundle (attached to the release) and Sigstore's trusted root (the
public keys and certificate authorities the bundle chains to).

**On a connected machine**, once per release:

```bash
gh release download v1.0.4 --repo ignite-ember/igni-app --dir igni-app-1.0.4
gh attestation trusted-root > igni-app-1.0.4/trusted_root.jsonl
```

`trusted_root.jsonl` is not a secret and changes rarely — only when Sigstore
rotates a key — but fetch it at or after the release date, so it includes the
keys the release was signed under.

**Carry the directory in. On the air-gapped machine** (a `gh` binary of 2.49
or later; with `--bundle` and `--custom-trusted-root` it contacts nothing):

```bash
cd igni-app-1.0.4
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify igni-desktop-installer.dmg \
  --repo ignite-ember/igni-app \
  --bundle igni-1.0.4.provenance.sigstore.json \
  --custom-trusted-root trusted_root.jsonl
```

The bundle carries the signing certificate and the transparency-log inclusion
proof, so nothing has to be looked up. The flags in step 2 (`--signer-workflow`,
`--source-ref`) work here too.

## 4. The cosign signature

**Not yet.** Releases are signed with a cosign key pair the same way igni
server signs its images: the private key held by Ignite Ember, the public key
(`igni-cosign.pub`) given to you once, through a channel other than the
release — with the contract, or compared by fingerprint. Never trust a key
that arrives with the files it is meant to check. The signature is not
recorded in a public transparency log, so verifying it needs only the public
key:

```bash
cosign verify-blob --key igni-cosign.pub --insecure-ignore-tlog=true \
  --signature SHA256SUMS.sig SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

`--insecure-ignore-tlog=true` is what a key-pair signature without a log entry
needs; it does not weaken the signature check. A pass means Ignite Ember's
release key signed this exact list of digests, and therefore every file whose
digest is on it.

Until the key ceremony has happened, releases have no `SHA256SUMS.sig`, and
the release workflow says so in its log. Provenance (steps 2 and 3) is
available from the first release built by this workflow regardless.

## What else signs a release

These are separate from the evidence above and predate it:

* **macOS** — the `.app` is signed with Ignite Ember's Apple Developer ID and
  notarised, and the ticket is stapled, so Gatekeeper checks it offline.
* **The macOS updater** — `latest.json` points at `igni_aarch64.app.tar.gz`
  with a minisign signature the installed app checks against the public key it
  ships with.
* **Windows and Linux installers** carry no platform code signature;
  provenance and, later, the cosign signature are what vouch for them.
