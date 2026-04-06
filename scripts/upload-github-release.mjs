#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const cwd = process.cwd();
const artifactPath = resolveArtifactPath(args.path, cwd);
assertApkArtifact(artifactPath);
const packageVersion = readPackageVersion(cwd);
const assetName = args.name ?? 's3man.apk';
const artifactMetadata = resolveArtifactMetadata({
  artifactPath,
  cwd,
  packageVersion,
  version: args.version,
  versionCode: args.versionCode,
});
const { owner, repo } = parseRepo(args.repo ?? detectGitHubRepo());
const tag = args.tag ?? `local-v${packageVersion}`;
const releaseName = args.title ?? tag;
const prerelease = args.prerelease ?? inferPrereleaseFromTag(tag);
const targetCommitish = args.target ?? readGitValue(['rev-parse', 'HEAD']);
const envFile = loadEnvFile(join(cwd, '.env.local'));
const token =
  envFile.GITHUB_TOKEN || envFile.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

console.log(`artifact: ${artifactPath}`);
console.log(`asset: ${assetName}`);
console.log(`repo: ${owner}/${repo}`);
console.log(`tag: ${tag}`);
console.log(`target: ${targetCommitish}`);
console.log(`prerelease: ${String(prerelease)}`);
console.log(`version: ${artifactMetadata.version}`);
console.log(`versionCode: ${String(artifactMetadata.versionCode)}`);

if (args.dryRun) {
  console.log('dry-run: skipped release creation and asset upload');
  process.exit(0);
}

if (!token) {
  throw new Error('Missing GITHUB_TOKEN or GH_TOKEN. Add it to .env.local or your shell env.');
}

const release = await getOrCreateRelease({
  owner,
  repo,
  tag,
  releaseName,
  prerelease,
  targetCommitish,
  token,
});

const uploadUrl = release.upload_url.replace('{?name,label}', '');
const fileBuffer = readFileSync(artifactPath);
const uploadedAsset = await uploadReleaseAsset({
  assetName,
  fileBuffer,
  owner,
  repo,
  release,
  token,
  uploadUrl,
});
const updateManifest = buildUpdateManifest({
  assetName,
  artifactMetadata,
  fileBuffer,
  owner,
  repo,
  release,
});
const manifestBuffer = Buffer.from(`${JSON.stringify(updateManifest, null, 2)}\n`, 'utf8');

const uploadedManifest = await uploadReleaseAsset({
  assetName: 'update.json',
  fileBuffer: manifestBuffer,
  owner,
  repo,
  release,
  token,
  uploadUrl,
  contentType: 'application/json',
});

console.log(`uploaded: ${uploadedAsset.browser_download_url}`);
console.log(`manifest: ${uploadedManifest.browser_download_url}`);
console.log(`release: ${release.html_url}`);

function parseArgs(rawArgs) {
  const parsed = {
    dryRun: false,
    help: false,
    prerelease: undefined,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith('-') && !parsed.path) {
      parsed.path = arg;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--prerelease') {
      parsed.prerelease = true;
      continue;
    }

    if (arg === '--no-prerelease') {
      parsed.prerelease = false;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    const next = rawArgs[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case '--path':
        parsed.path = next;
        break;
      case '--tag':
        parsed.tag = next;
        break;
      case '--repo':
        parsed.repo = next;
        break;
      case '--name':
        parsed.name = next;
        break;
      case '--title':
        parsed.title = next;
        break;
      case '--target':
        parsed.target = next;
        break;
      case '--version':
        parsed.version = next;
        break;
      case '--version-code':
        parsed.versionCode = Number.parseInt(next, 10);
        if (!Number.isInteger(parsed.versionCode) || parsed.versionCode <= 0) {
          throw new Error(`Invalid value for --version-code: ${next}`);
        }
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  pnpm upload:github -- [artifact-path]

Options:
  --path <file>      APK file path. If omitted, auto-detect latest file.
  --tag <tag>        Git tag name. Default: local-v<package.json version>
  --repo <owner/repo>
                     GitHub repository. Default: detect from git remote origin
  --name <filename>  APK asset name on the release. Default: s3man.apk
  --title <name>     Release title. Default: same as tag
  --target <ref>     Commit/branch for release creation. Default: current HEAD
  --version <name>   Override versionName written into update.json
  --version-code <n> Override versionCode written into update.json
  --prerelease       Mark release as prerelease
  --no-prerelease    Force release to non-prerelease
  --dry-run          Print resolved values without uploading
  -h, --help         Show this help

Examples:
  # .env.local:
  # GITHUB_TOKEN=github_pat_xxx
  #
  pnpm upload:github -- --dry-run
  pnpm upload:github -- android/app/build/outputs/apk/release/app-release.apk
  pnpm upload:github -- --tag local-v1.0.3
  pnpm upload:github -- --tag v1.0.3 --version 1.0.3 --version-code 3
  `);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function resolveArtifactPath(inputPath, currentWorkingDirectory) {
  if (inputPath) {
    const absolutePath = isAbsolute(inputPath)
      ? inputPath
      : resolve(currentWorkingDirectory, inputPath);
    validateArtifactPath(absolutePath);
    return absolutePath;
  }

  const detected = detectLatestArtifact(currentWorkingDirectory);
  if (!detected) {
    throw new Error('No APK/AAB file found. Pass --path or build from Android Studio first.');
  }

  return detected;
}

function assertApkArtifact(filePath) {
  if (extname(filePath).toLowerCase() !== '.apk') {
    throw new Error(`In-app update publishing requires an APK artifact. Received: ${filePath}`);
  }
}

function validateArtifactPath(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Artifact not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Artifact is not a file: ${filePath}`);
  }

  if (extname(filePath).toLowerCase() !== '.apk') {
    throw new Error(`Unsupported artifact type: ${filePath}`);
  }
}

function detectLatestArtifact(currentWorkingDirectory) {
  const outputRoot = join(currentWorkingDirectory, 'android', 'app', 'build', 'outputs');
  if (!existsSync(outputRoot)) {
    return null;
  }

  const files = walkFiles(outputRoot)
    .filter((filePath) => {
      return extname(filePath).toLowerCase() === '.apk';
    })
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  return files[0] ?? null;
}

function walkFiles(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function detectGitHubRepo() {
  const remoteUrl = readGitValue(['remote', 'get-url', 'origin']);
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`);
}

function parseRepo(value) {
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid repo value: ${value}`);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function readPackageVersion(currentWorkingDirectory) {
  const packageJsonPath = join(currentWorkingDirectory, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version) {
    throw new Error('package.json version is missing');
  }

  return packageJson.version;
}

function readAppConfig(currentWorkingDirectory) {
  const appJsonPath = join(currentWorkingDirectory, 'app.json');
  if (!existsSync(appJsonPath)) {
    return null;
  }

  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const expo = appJson?.expo ?? {};

  return {
    version: typeof expo.version === 'string' ? expo.version : null,
    versionCode: typeof expo.android?.versionCode === 'number' ? expo.android.versionCode : null,
  };
}

function readArtifactOutputMetadata(artifactPath) {
  const metadataPath = join(dirname(artifactPath), 'output-metadata.json');
  if (!existsSync(metadataPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const output = Array.isArray(parsed?.elements) ? parsed.elements[0] : null;

  if (!output) {
    return null;
  }

  return {
    version:
      typeof output.versionName === 'string' && output.versionName.trim()
        ? output.versionName.trim()
        : null,
    versionCode:
      typeof output.versionCode === 'number' && Number.isFinite(output.versionCode)
        ? output.versionCode
        : null,
  };
}

function resolveArtifactMetadata({ artifactPath, cwd, packageVersion, version, versionCode }) {
  const outputMetadata = readArtifactOutputMetadata(artifactPath);
  const appConfig = readAppConfig(cwd);

  const resolvedVersion =
    version ?? outputMetadata?.version ?? appConfig?.version ?? packageVersion;
  const resolvedVersionCode = versionCode ?? outputMetadata?.versionCode ?? appConfig?.versionCode;

  if (!resolvedVersion) {
    throw new Error('Unable to resolve versionName for update.json');
  }

  if (!Number.isInteger(resolvedVersionCode) || resolvedVersionCode <= 0) {
    throw new Error(
      'Unable to resolve versionCode for update.json. Pass --version-code or set expo.android.versionCode.'
    );
  }

  return {
    version: resolvedVersion,
    versionCode: resolvedVersionCode,
  };
}

function readGitValue(argsList) {
  return execFileSync('git', argsList, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function inferPrereleaseFromTag(tag) {
  return /v?\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(tag);
}

function getContentType(filePath) {
  return extname(filePath).toLowerCase() === '.apk'
    ? 'application/vnd.android.package-archive'
    : 'application/octet-stream';
}

async function getOrCreateRelease({
  owner,
  repo,
  tag,
  releaseName,
  prerelease,
  targetCommitish,
  token,
}) {
  try {
    return await githubRequest({
      method: 'GET',
      url: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      token,
    });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  console.log(`create release: ${tag}`);
  return githubRequest({
    method: 'POST',
    url: `https://api.github.com/repos/${owner}/${repo}/releases`,
    token,
    body: {
      tag_name: tag,
      target_commitish: targetCommitish,
      name: releaseName,
      prerelease,
      generate_release_notes: true,
    },
  });
}

async function uploadReleaseAsset({
  assetName,
  fileBuffer,
  owner,
  repo,
  release,
  token,
  uploadUrl,
  contentType = 'application/octet-stream',
}) {
  const existingAsset = Array.isArray(release.assets)
    ? release.assets.find((asset) => asset.name === assetName)
    : undefined;

  if (existingAsset) {
    console.log(`delete old asset: ${assetName}`);
    await githubRequest({
      method: 'DELETE',
      url: `https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`,
      token,
    });
  }

  return githubRequest({
    method: 'POST',
    url: `${uploadUrl}?name=${encodeURIComponent(assetName)}`,
    token,
    headers: {
      'Content-Length': String(fileBuffer.length),
      'Content-Type': contentType,
    },
    body: fileBuffer,
  });
}

function buildUpdateManifest({ assetName, artifactMetadata, fileBuffer, owner, repo, release }) {
  return {
    version: artifactMetadata.version,
    versionCode: artifactMetadata.versionCode,
    publishedAt: release.published_at ?? new Date().toISOString(),
    notes: release.body?.trim() || release.name || release.tag_name,
    apkUrl: `https://github.com/${owner}/${repo}/releases/latest/download/${assetName}`,
    sha256: createHash('sha256').update(fileBuffer).digest('hex'),
    sizeBytes: fileBuffer.length,
  };
}

async function githubRequest({ method, url, token, headers = {}, body }) {
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 's3man-release-uploader',
    'X-GitHub-Api-Version': '2022-11-28',
    ...headers,
  };

  let requestBody = body;
  if (body && !(body instanceof Uint8Array)) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });

  if (response.status === 204) {
    return null;
  }

  const responseText = await response.text();
  const parsedBody = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const error = new Error(
      parsedBody?.message || `GitHub API request failed with status ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return parsedBody;
}
