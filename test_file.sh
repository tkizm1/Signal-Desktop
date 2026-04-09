#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const asar = require('@electron/asar');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  fail(
    [
      'Usage:',
      '  node test_file.sh <client-dir|client.zip|app.asar> [environment]',
      '',
      'Examples:',
      '  node test_file.sh /root/Downloads/signal development',
      '  node test_file.sh ./release-dev-zip/pack/signal-desktop_8.8.0-alpha.1_x64.zip development',
    ].join('\n')
  );
}

function extractZipEntry(zipPath, entryName) {
  const buffer = fs.readFileSync(zipPath);

  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) !== 0x06054b50) {
      continue;
    }

    const centralDirectorySize = buffer.readUInt32LE(i + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(i + 16);
    let pointer = centralDirectoryOffset;
    const end = centralDirectoryOffset + centralDirectorySize;

    while (pointer < end) {
      if (buffer.readUInt32LE(pointer) !== 0x02014b50) {
        throw new Error(`Invalid central directory entry in ${zipPath}`);
      }

      const compressionMethod = buffer.readUInt16LE(pointer + 10);
      const compressedSize = buffer.readUInt32LE(pointer + 20);
      const fileNameLength = buffer.readUInt16LE(pointer + 28);
      const extraLength = buffer.readUInt16LE(pointer + 30);
      const commentLength = buffer.readUInt16LE(pointer + 32);
      const localHeaderOffset = buffer.readUInt32LE(pointer + 42);
      const fileName = buffer
        .slice(pointer + 46, pointer + 46 + fileNameLength)
        .toString('utf8');

      if (fileName === entryName) {
        if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
          throw new Error(`Invalid local header for ${entryName}`);
        }

        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart =
          localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressedData = buffer.slice(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          return compressedData;
        }

        if (compressionMethod === 8) {
          return zlib.inflateRawSync(compressedData);
        }

        throw new Error(
          `Unsupported zip compression method ${compressionMethod} for ${entryName}`
        );
      }

      pointer += 46 + fileNameLength + extraLength + commentLength;
    }

    break;
  }

  throw new Error(`Zip entry not found: ${entryName}`);
}

function findAppAsar(startPath) {
  const queue = [startPath];

  while (queue.length > 0) {
    const current = queue.shift();
    const stat = fs.statSync(current);

    if (stat.isFile() && path.basename(current) === 'app.asar') {
      return current;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      queue.push(path.join(current, entry.name));
    }
  }

  return null;
}

function readAsarJson(asarPath, innerPath) {
  try {
    const text = asar.extractFile(asarPath, innerPath).toString('utf8');
    return JSON.parse(text);
  } catch (error) {
    const message = error && typeof error.message === 'string' ? error.message : '';
    if (
      message.includes('Cannot read properties of undefined') ||
      message.includes('was not found in this archive')
    ) {
      return null;
    }

    throw new Error(`Failed to parse ${innerPath}: ${message || String(error)}`);
  }
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return b;
  }

  if (!a || typeof a !== 'object') {
    return b;
  }

  if (!b || typeof b !== 'object') {
    return b;
  }

  const output = { ...a };
  for (const [key, value] of Object.entries(b)) {
    output[key] = key in output ? deepMerge(output[key], value) : value;
  }
  return output;
}

function resolveTrustRootsPath(appRoot, trustRootsPath) {
  if (!trustRootsPath) {
    return null;
  }

  return path.isAbsolute(trustRootsPath)
    ? trustRootsPath
    : path.join(appRoot, trustRootsPath);
}

function readExternalTrustRoots(resolvedPath) {
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8').trim();
  if (!raw) {
    return [];
  }

  return raw.startsWith('[')
    ? JSON.parse(raw)
    : raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function inspectTarget(targetPath, environment) {
  const stat = fs.statSync(targetPath);

  if (stat.isFile() && targetPath.endsWith('.zip')) {
    const asarBytes = extractZipEntry(targetPath, 'resources/app.asar');
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'client-info-'));
    const asarPath = path.join(tempDir, 'app.asar');
    fs.writeFileSync(asarPath, asarBytes);
    return {
      appAsar: asarPath,
      appRoot: path.dirname(targetPath),
      cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
      inputType: 'zip',
      environment,
      source: targetPath,
    };
  }

  if (stat.isFile() && path.basename(targetPath) === 'app.asar') {
    return {
      appAsar: targetPath,
      appRoot: path.dirname(path.dirname(targetPath)),
      cleanup: null,
      inputType: 'asar',
      environment,
      source: targetPath,
    };
  }

  if (stat.isDirectory()) {
    const appAsar = findAppAsar(targetPath);
    if (!appAsar) {
      throw new Error(`app.asar not found under ${targetPath}`);
    }

    return {
      appAsar,
      appRoot: path.dirname(path.dirname(appAsar)),
      cleanup: null,
      inputType: 'directory',
      environment,
      source: targetPath,
    };
  }

  throw new Error(`Unsupported target: ${targetPath}`);
}

function main() {
  const [, , rawTarget, rawEnvironment] = process.argv;

  if (!rawTarget) {
    usage();
  }

  const targetPath = path.resolve(rawTarget);
  if (!fs.existsSync(targetPath)) {
    fail(`Target not found: ${targetPath}`);
  }

  const environment = rawEnvironment || 'development';
  const inspected = inspectTarget(targetPath, environment);

  try {
    const configs = {
      default: readAsarJson(inspected.appAsar, 'config/default.json'),
      env: readAsarJson(inspected.appAsar, `config/${environment}.json`),
      localEnv: readAsarJson(
        inspected.appAsar,
        `config/local-${environment}.json`
      ),
    };

    let effectiveConfig = {};
    for (const candidate of [configs.default, configs.env, configs.localEnv]) {
      if (candidate) {
        effectiveConfig = deepMerge(effectiveConfig, candidate);
      }
    }

    const serverTrustRootsPath = effectiveConfig.serverTrustRootsPath || null;
    const resolvedServerTrustRootsPath = resolveTrustRootsPath(
      inspected.appRoot,
      serverTrustRootsPath
    );
    const externalServerTrustRoots = readExternalTrustRoots(
      resolvedServerTrustRootsPath
    );

    const result = {
      source: inspected.source,
      inputType: inspected.inputType,
      appAsar: inspected.appAsar,
      appRoot: inspected.appRoot,
      environment,
      configFilesPresent: {
        default: !!configs.default,
        env: !!configs.env,
        localEnv: !!configs.localEnv,
      },
      serverUrl: effectiveConfig.serverUrl || null,
      serverTrustRootsPath,
      resolvedServerTrustRootsPath,
      configuredServerTrustRoots: effectiveConfig.serverTrustRoots || [],
      externalServerTrustRoots,
      effectiveServerTrustRoots:
        externalServerTrustRoots ?? (effectiveConfig.serverTrustRoots || []),
      serverPublicParamsPrefix: (effectiveConfig.serverPublicParams || '').slice(
        0,
        48
      ),
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    inspected.cleanup?.();
  }
}

main();
