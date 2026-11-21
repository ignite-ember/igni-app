// The release's latest.json, assembled the way release.yml's
// ``updater-json`` job assembles it: from the signature each build leg
// stashes. ``node --test scripts/`` (``make release-scripts-test``).

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ALL_PLATFORMS, LEGS, buildLatestJson } from "./latest-json.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const SCRIPT = join(here, "latest-json.mjs");
const STASH = join(here, "stash-updater-sig.sh");
const BASE = "https://github.com/ignite-ember/igni-app/releases/download/v1.0.6";
const DATE = "2026-11-20T12:00:00Z";

/** A .sig as tauri-bundler writes it: base64 of a minisign signature,
 *  whose trusted comment names the signed file. */
function fakeSig(file) {
  const minisig =
    "untrusted comment: signature from tauri secret key\n" +
    `RUR${Buffer.from(file).toString("base64").replace(/=/g, "")}\n` +
    `trusted comment: timestamp:1795000000\tfile:${file}\n` +
    "c2lnbmF0dXJlLW9mLXRoZS1jb21tZW50\n";
  return Buffer.from(minisig).toString("base64");
}

const ASSETS = {
  "updater-sig-linux-appimage": "igni_1.0.6_amd64.AppImage",
  "updater-sig-windows-msi": "igni_1.0.6_x64_en-US.msi",
  "updater-sig-windows-nsis": "igni_1.0.6_x64-setup.exe",
};

/** The directory download-artifact leaves: one folder per stash. */
function stashes({ skip = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "latest-json-"));
  const sigs = {};
  for (const name of Object.keys(LEGS)) {
    if (skip.includes(name)) continue;
    mkdirSync(join(dir, name));
    const file = ASSETS[name] ?? "igni.app.tar.gz";
    sigs[name] = fakeSig(file);
    writeFileSync(join(dir, name, "updater.sig"), sigs[name]);
    if (ASSETS[name]) writeFileSync(join(dir, name, "asset"), `${ASSETS[name]}\n`);
  }
  return { dir, sigs };
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("the release's latest.json serves every installer, from its own signature", () => {
  const { dir, sigs } = stashes();
  const out = join(dir, "latest.json");
  const assetsOut = join(dir, "assets.txt");
  const res = run([
    "--sigs", dir, "--version", "v1.0.6", "--base-url", BASE, "--pub-date", DATE,
    "--expect", ALL_PLATFORMS.join(","), "--out", out, "--assets-out", assetsOut,
  ]);
  assert.equal(res.status, 0, res.stderr);
  const manifest = JSON.parse(readFileSync(out, "utf8"));

  assert.equal(manifest.version, "1.0.6", "the tag's v is dropped");
  assert.equal(manifest.pub_date, DATE);
  assert.equal(typeof manifest.notes, "string");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "linux-x86_64-appimage",
    "windows-x86_64",
    "windows-x86_64-msi",
    "windows-x86_64-nsis",
  ]);
  const want = {
    "darwin-aarch64": ["updater-sig-aarch64", "igni_aarch64.app.tar.gz"],
    "linux-x86_64-appimage": ["updater-sig-linux-appimage", "igni_1.0.6_amd64.AppImage"],
    "windows-x86_64-msi": ["updater-sig-windows-msi", "igni_1.0.6_x64_en-US.msi"],
    "windows-x86_64-nsis": ["updater-sig-windows-nsis", "igni_1.0.6_x64-setup.exe"],
    "windows-x86_64": ["updater-sig-windows-nsis", "igni_1.0.6_x64-setup.exe"],
  };
  for (const [key, [stash, asset]] of Object.entries(want)) {
    const entry = manifest.platforms[key];
    assert.deepEqual(Object.keys(entry).sort(), ["signature", "url"], key);
    assert.equal(entry.url, `${BASE}/${asset}`, key);
    assert.equal(entry.signature, sigs[stash], `${key} carries ${stash}'s signature`);
    // The trusted comment names the file the bundler signed: the bundle
    // itself, except on macOS, where it signs igni.app.tar.gz before the
    // leg renames the stapled tarball to igni_aarch64.app.tar.gz.
    const signed = key.startsWith("darwin") ? "igni.app.tar.gz" : asset;
    const decoded = Buffer.from(entry.signature, "base64").toString("utf8");
    assert.ok(decoded.split("\n").some((l) => l.endsWith(`file:${signed}`)), `${key}'s signature is over ${signed}`);
  }
  assert.deepEqual(readFileSync(assetsOut, "utf8").trim().split("\n").sort(), Object.values(want).map(([, a]) => a).filter((a, i, all) => all.indexOf(a) === i).sort());
});

test("no plain linux-x86_64: a .deb or .rpm install must not be offered the AppImage", () => {
  const { dir } = stashes();
  const { manifest } = buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: BASE, pubDate: DATE, notes: "" });
  assert.ok(!("linux-x86_64" in manifest.platforms));
  assert.ok(!Object.keys(manifest.platforms).some((k) => /-(deb|rpm)$/.test(k)));
});

test("the shape is what tauri-plugin-updater's RemoteRelease reads", () => {
  const { dir } = stashes();
  const { manifest } = buildLatestJson({ sigsDir: dir, version: "v1.0.6-rc.1", baseUrl: BASE, pubDate: DATE, notes: "n" });
  assert.match(manifest.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.version, "1.0.6-rc.1");
  assert.ok(!Number.isNaN(Date.parse(manifest.pub_date)));
  for (const [key, entry] of Object.entries(manifest.platforms)) {
    assert.match(key, /^(darwin|linux|windows)-(x86_64|aarch64|i686|armv7)(-(app|appimage|deb|rpm|msi|nsis))?$/);
    assert.ok(new URL(entry.url).protocol === "https:", key);
    assert.match(entry.signature, /^[A-Za-z0-9+/]+=*$/, key);
  }
});

test("a leg that stashed nothing fails the release", () => {
  const { dir } = stashes({ skip: ["updater-sig-windows-msi"] });
  const res = run(["--sigs", dir, "--version", "v1.0.6", "--base-url", BASE, "--expect", ALL_PLATFORMS.join(","), "--out", join(dir, "o.json")]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no signature stashed for windows-x86_64-msi/);
});

test("a signature that is not a minisign signature is refused", () => {
  const { dir } = stashes();
  writeFileSync(join(dir, "updater-sig-linux-appimage", "updater.sig"), Buffer.from("not a signature").toString("base64"));
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: BASE, pubDate: DATE, notes: "" }), /minisign/);
  writeFileSync(join(dir, "updater-sig-linux-appimage", "updater.sig"), "");
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: BASE, pubDate: DATE, notes: "" }), /empty/);
});

test("a stash without its asset name, or with an unknown name, is refused", () => {
  let { dir } = stashes();
  writeFileSync(join(dir, "updater-sig-windows-nsis", "asset"), "../evil.exe\n");
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: BASE, pubDate: DATE, notes: "" }), /unusable asset/);
  ({ dir } = stashes());
  mkdirSync(join(dir, "updater-sig-mystery"));
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: BASE, pubDate: DATE, notes: "" }), /unknown stash/);
});

test("the version and the base URL are checked", () => {
  const { dir } = stashes();
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "latest", baseUrl: BASE, pubDate: DATE, notes: "" }), /semver/);
  assert.throws(() => buildLatestJson({ sigsDir: dir, version: "1.0.6", baseUrl: "http://example.com/x", pubDate: DATE, notes: "" }), /https/);
});

test("the stash script takes the bundle's own .sig and names the bundle", (t) => {
  if (process.platform === "win32") return t.skip("bash script");
  const work = mkdtempSync(join(tmpdir(), "stash-"));
  const bundle = join(work, "bundle");
  const layout = {
    appimage: ["appimage", "igni_1.0.6_amd64.AppImage"],
    msi: ["msi", "igni_1.0.6_x64_en-US.msi"],
    nsis: ["nsis", "igni_1.0.6_x64-setup.exe"],
  };
  for (const [kind, [sub, file]] of Object.entries(layout)) {
    mkdirSync(join(bundle, sub), { recursive: true });
    writeFileSync(join(bundle, sub, file), `${kind} payload`);
    writeFileSync(join(bundle, sub, `${file}.sig`), `${fakeSig(file)}\n`);
  }
  // A .deb's .sig beside them is not the AppImage's.
  mkdirSync(join(bundle, "deb"));
  writeFileSync(join(bundle, "deb", "igni_1.0.6_amd64.deb.sig"), fakeSig("igni_1.0.6_amd64.deb"));
  const env = { ...process.env, RELEASE_TAG: "", GH_TOKEN: "" };
  for (const [kind, [sub, file]] of Object.entries(layout)) {
    const out = join(work, "out", kind);
    execFileSync("bash", [STASH, kind, bundle, out], { env, encoding: "utf8" });
    assert.equal(readFileSync(join(out, "asset"), "utf8").trim(), file);
    assert.equal(readFileSync(join(out, "updater.sig"), "utf8"), fakeSig(file), `${kind}: the bundle's own .sig, one line`);
  }
  // No .sig: the build was not signed, and the leg fails.
  writeFileSync(join(bundle, "msi", "igni_1.0.6_x64_en-US.msi.sig"), "");
  const res = spawnSync("bash", [STASH, "msi", bundle, join(work, "out", "x")], { env, encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /missing or empty/);
});

test("release.yml stashes what the script reads and expects every key", () => {
  const yml = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
  const uploaded = [...yml.matchAll(/name: (updater-sig-[a-z0-9-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(uploaded, Object.keys(LEGS).sort(), "every stash release.yml uploads is a leg the script knows, and back");
  const expect = yml.match(/--expect ([a-z0-9_,-]+)/)[1].split(",").sort();
  assert.deepEqual(expect, [...ALL_PLATFORMS].sort());
  for (const kind of ["appimage", "msi", "nsis"]) {
    assert.ok(yml.includes(`stash-updater-sig.sh ${kind}`) || (kind !== "appimage" && yml.includes("for kind in msi nsis")), kind);
  }
  // The macOS leg's stapled-tarball path is what darwin-aarch64 serves.
  assert.ok(yml.includes('REMOTE_NAME="igni_aarch64.app.tar.gz"'));
  assert.equal(LEGS["updater-sig-aarch64"].asset, "igni_aarch64.app.tar.gz");
});
