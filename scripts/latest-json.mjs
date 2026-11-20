#!/usr/bin/env node
// The release's ``latest.json``: what an installed igni polls to find a
// newer version (tauri-plugin-updater; the endpoint is compiled into
// clients/tauri/src-tauri/tauri.conf.json).
//
// Each build leg of release.yml stashes the minisign signature of the
// bundle it uploaded, as an artifact named for the leg, holding
// ``updater.sig`` (the .sig file tauri-bundler wrote, already the base64
// form the plugin reads) and, but for the macOS leg, ``asset`` (the name the
// bundle was uploaded to the release under). ``updater-json`` downloads them
// all into one directory and runs this:
//
//   node scripts/latest-json.mjs --sigs /tmp/sigs --version v1.0.6 \
//     --base-url https://github.com/<repo>/releases/download/v1.0.6 \
//     --expect darwin-aarch64,linux-x86_64-appimage,... --out latest.json
//
// The plugin looks up ``<os>-<arch>-<installer>`` first, then
// ``<os>-<arch>``, and the installer is the bundle type the running app was
// installed from. So:
//
//   • macOS: ``darwin-aarch64``, the stapled ``igni_aarch64.app.tar.gz``
//     the macOS leg re-uploads after notarizing (the only Mac build).
//   • Linux: ``linux-x86_64-appimage`` only. No plain ``linux-x86_64``: a
//     .deb or .rpm install would fall back to it and be offered an AppImage
//     its installer cannot apply. Those installs are updated by installing
//     the new package, as before.
//   • Windows: ``windows-x86_64-msi`` and ``windows-x86_64-nsis``, each its
//     own installer, and ``windows-x86_64`` → NSIS for an app whose bundle
//     type is unknown (the per-user installer: no elevation, and it never
//     touches a machine-wide .msi install).
//
// ``--expect`` names the keys that must come out; a leg that stashed
// nothing fails the release rather than shipping a latest.json that leaves
// a platform behind.

import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The stash each build leg uploads, and the keys its bundle serves. */
export const LEGS = {
  "updater-sig-aarch64": { platforms: ["darwin-aarch64"], asset: "igni_aarch64.app.tar.gz" },
  "updater-sig-linux-appimage": { platforms: ["linux-x86_64-appimage"] },
  "updater-sig-windows-msi": { platforms: ["windows-x86_64-msi"] },
  "updater-sig-windows-nsis": { platforms: ["windows-x86_64-nsis", "windows-x86_64"] },
};

/** Every key a full release serves. */
export const ALL_PLATFORMS = Object.values(LEGS).flatMap((leg) => leg.platforms);

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(message);
}

/** A .sig file as the plugin wants it: base64 of a minisign signature. */
export function readSignature(path) {
  const text = readFileSync(path, "utf8").trim();
  if (!text) fail(`${path} is empty`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(text)) fail(`${path} is not one line of base64`);
  const decoded = Buffer.from(text, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:") || !decoded.includes("\ntrusted comment:")) {
    fail(`${path} does not decode to a minisign signature`);
  }
  return text;
}

function readAsset(dir, leg, legName) {
  if (leg.asset) return leg.asset;
  const path = join(dir, "asset");
  if (!existsSync(path)) fail(`${legName} has no asset file naming its release asset`);
  const name = readFileSync(path, "utf8").trim();
  if (!name || /[\\/\s]/.test(name)) fail(`${legName} names an unusable asset: ${JSON.stringify(name)}`);
  return name;
}

/**
 * Build latest.json from the stashes under ``sigsDir``.
 * @returns {{manifest: object, assets: Record<string, string>}}
 */
export function buildLatestJson({ sigsDir, version, baseUrl, pubDate, notes, expect = [] }) {
  const v = String(version).replace(/^v/, "");
  if (!VERSION_RE.test(v)) fail(`not a semver version: ${JSON.stringify(version)}`);
  if (!/^https:\/\/\S+[^/]$/.test(baseUrl)) fail(`base URL must be https and not end in /: ${baseUrl}`);
  if (Number.isNaN(Date.parse(pubDate)) || !/Z$|[+-]\d\d:\d\d$/.test(pubDate)) fail(`pub_date is not RFC 3339: ${pubDate}`);

  const platforms = {};
  const assets = {};
  const present = existsSync(sigsDir) ? readdirSync(sigsDir) : [];
  for (const name of present) {
    const leg = LEGS[name];
    if (!leg) fail(`unknown stash ${name}; known: ${Object.keys(LEGS).join(", ")}`);
    const dir = join(sigsDir, name);
    const signature = readSignature(join(dir, "updater.sig"));
    const asset = readAsset(dir, leg, name);
    assets[name] = asset;
    for (const key of leg.platforms) {
      platforms[key] = { signature, url: `${baseUrl}/${encodeURIComponent(asset)}` };
    }
  }
  const missing = expect.filter((key) => !platforms[key]);
  if (missing.length) fail(`no signature stashed for ${missing.join(", ")} (stashes: ${present.join(", ") || "none"})`);
  if (!Object.keys(platforms).length) fail(`no stashes under ${sigsDir}`);

  const sorted = Object.fromEntries(Object.keys(platforms).sort().map((k) => [k, platforms[k]]));
  return {
    manifest: { version: v, notes, pub_date: pubDate, platforms: sorted },
    assets,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith("--") || i + 1 >= argv.length) fail(`bad argument ${flag}`);
    out[flag.slice(2)] = argv[i + 1];
  }
  for (const required of ["sigs", "version", "base-url", "out"]) {
    if (!out[required]) fail(`--${required} is required`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { manifest, assets } = buildLatestJson({
    sigsDir: args.sigs,
    version: args.version,
    baseUrl: args["base-url"],
    pubDate: args["pub-date"] || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    notes: args.notes || "See the GitHub release page for the changelog.",
    expect: (args.expect || "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  writeFileSync(args.out, JSON.stringify(manifest, null, 2) + "\n");
  if (args["assets-out"]) writeFileSync(args["assets-out"], Object.values(assets).join("\n") + "\n");
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

const invoked = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]);
if (invoked && realpathSync(fileURLToPath(import.meta.url)) === invoked) {
  try {
    main();
  } catch (e) {
    console.error(`latest-json: ${e.message}`);
    process.exit(1);
  }
}
