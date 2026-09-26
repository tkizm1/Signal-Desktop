// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { PrivateKey } from '@signalapp/libsignal-client';
import { ServerSecretParams } from '@signalapp/libsignal-client/zkgroup';
import { FAILSAFE_SCHEMA, load as loadYaml } from 'js-yaml';

type ExtractedParams = Readonly<{
  serverPublicParams: string;
  serverTrustRoots: ReadonlyArray<string>;
  genericServerPublicParams?: string;
  backupServerPublicParams?: string;
  source: Readonly<{
    mode: 'mock-certs' | 'signal-server';
    configPath?: string;
    secretsPath?: string;
    mockCertsDir?: string;
    trustRootSource?: string;
  }>;
}>;

type Options = Readonly<{
  configPath?: string;
  mockCertsDir?: string;
  outPath?: string;
  secretsPath?: string;
  trustRootInput?: string;
  trustRootKey?: string;
}>;

function printHelp(): void {
  console.log(`Extract Signal Desktop server params from server-side files.

Usage:
  pnpm run extract-server-params -- --mock-certs /path/to/Mock-Signal-Server/certs
  pnpm run extract-server-params -- --config /path/to/config.yml --secrets /path/to/secrets.yml --trust-root /path/to/trust-root.json
  pnpm run extract-server-params -- --config /path/to/config.yml --secrets /path/to/secrets.yml --trust-root-key trustRoot.privateKey

Options:
  --mock-certs <dir>    Extract from Mock-Signal-Server certs directory.
  --config <file>       Extract from Signal-Server config YAML.
  --secrets <file>      Signal-Server secrets bundle YAML or JSON.
  --trust-root <value>  Trust root as a file path, JSON blob, or raw base64 key.
  --trust-root-key <k>  Key to read from the secrets file. Supports either a
                        33-byte public key or 32-byte private key in base64.
  --out <file>          Write output JSON to a file instead of stdout only.

Notes:
  - serverPublicParams comes from zkConfig.serverPublic, or is derived from
    zkConfig.serverSecret when serverPublic is not present.
  - serverTrustRoots cannot be recovered from unidentifiedDelivery.certificate
    alone. You must provide the trust-root public key, its private key, or a
    file like Mock-Signal-Server's trust-root.json.
`);
}

function parseArgs(argv: ReadonlyArray<string>): Options {
  const mutable: {
    configPath?: string;
    mockCertsDir?: string;
    outPath?: string;
    secretsPath?: string;
    trustRootInput?: string;
    trustRootKey?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--config') {
      mutable.configPath = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === '--mock-certs') {
      mutable.mockCertsDir = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === '--out') {
      mutable.outPath = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === '--secrets') {
      mutable.secretsPath = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === '--trust-root') {
      mutable.trustRootInput = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    if (arg === '--trust-root-key') {
      mutable.trustRootKey = requireNextValue(arg, next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (mutable.mockCertsDir && mutable.configPath) {
    throw new Error('Use either --mock-certs or --config, not both.');
  }

  if (!mutable.mockCertsDir && !mutable.configPath) {
    throw new Error('Missing input. Pass --mock-certs or --config.');
  }

  return mutable;
}

function requireNextValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function resolvePath(input: string): string {
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function loadStructuredFile(path: string): unknown {
  const text = readTextFile(path);

  if (path.endsWith('.json')) {
    return JSON.parse(text) as unknown;
  }

  return loadYaml(text, { schema: FAILSAFE_SCHEMA, json: true }) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function getNestedValue(
  record: Record<string, unknown>,
  dottedPath: string
): unknown {
  if (Object.hasOwn(record, dottedPath)) {
    return record[dottedPath];
  }

  const parts = dottedPath.split('.');
  let current: unknown = record;

  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    const currentRecord = current as Record<string, unknown>;
    if (!Object.hasOwn(currentRecord, part)) {
      return undefined;
    }

    current = currentRecord[part];
  }

  return current;
}

function getStringValue(
  record: Record<string, unknown>,
  dottedPath: string
): string | undefined {
  const value = getNestedValue(record, dottedPath);
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${dottedPath} must be a string`);
  }

  return value.trim();
}

function getRequiredStringValue(
  record: Record<string, unknown>,
  dottedPath: string
): string {
  const value = getStringValue(record, dottedPath);
  if (!value) {
    throw new Error(`Missing required string: ${dottedPath}`);
  }

  return value;
}

function resolveSecretValue(
  rawValue: string | undefined,
  secrets: Record<string, unknown> | undefined,
  sourcePath: string
): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (!rawValue.startsWith('secret://')) {
    return rawValue;
  }

  if (!secrets) {
    throw new Error(
      `${sourcePath} points at ${rawValue}, but no --secrets file was provided`
    );
  }

  const secretKey = rawValue.slice('secret://'.length);
  return getRequiredStringValue(secrets, secretKey);
}

function decodeBase64(input: string, label: string): Buffer {
  try {
    return Buffer.from(input.trim(), 'base64');
  } catch (error) {
    throw new Error(`${label} is not valid base64: ${String(error)}`);
  }
}

function derivePublicKeyFromPrivateKey(privateKeyBase64: string): string {
  const privateKeyBytes = decodeBase64(privateKeyBase64, 'trust root private key');
  const privateKey = PrivateKey.deserialize(new Uint8Array(privateKeyBytes));
  return Buffer.from(privateKey.getPublicKey().serialize()).toString('base64');
}

function normalizeTrustRootValue(
  value: string,
  sourceLabel: string
): Readonly<{
  key: string;
  source: string;
}> {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${sourceLabel} is empty`);
  }

  let candidate = trimmed;

  if (trimmed.startsWith('{')) {
    const parsed = asRecord(JSON.parse(trimmed) as unknown, sourceLabel);
    const publicKey = getStringValue(parsed, 'publicKey');
    if (publicKey) {
      return { key: publicKey, source: `${sourceLabel}:publicKey` };
    }

    const privateKey = getStringValue(parsed, 'privateKey');
    if (privateKey) {
      return {
        key: derivePublicKeyFromPrivateKey(privateKey),
        source: `${sourceLabel}:privateKey`,
      };
    }

    throw new Error(
      `${sourceLabel} JSON must contain either publicKey or privateKey`
    );
  }

  const decoded = decodeBase64(candidate, sourceLabel);

  if (decoded.length === 33) {
    return { key: candidate, source: sourceLabel };
  }

  if (decoded.length === 32) {
    return {
      key: derivePublicKeyFromPrivateKey(candidate),
      source: `${sourceLabel}:derived-from-private-key`,
    };
  }

  throw new Error(
    `${sourceLabel} decoded to ${decoded.length} bytes; expected 33-byte public key or 32-byte private key`
  );
}

function loadTrustRootFromInput(
  trustRootInput: string
): Readonly<{
  key: string;
  source: string;
}> {
  if (existsSync(trustRootInput)) {
    const fullPath = resolvePath(trustRootInput);
    return normalizeTrustRootValue(readTextFile(fullPath), fullPath);
  }

  return normalizeTrustRootValue(trustRootInput, 'inline trust root');
}

function deriveServerPublicParams(serverSecretBase64: string): string {
  const secretParams = new ServerSecretParams(
    new Uint8Array(decodeBase64(serverSecretBase64, 'zkConfig.serverSecret'))
  );
  return Buffer.from(secretParams.getPublicParams().serialize()).toString(
    'base64'
  );
}

function extractFromMockCerts(mockCertsDir: string): ExtractedParams {
  const certsDir = resolvePath(mockCertsDir);
  const trustRoot = asRecord(
    loadStructuredFile(resolve(certsDir, 'trust-root.json')),
    'trust-root.json'
  );
  const zkParams = asRecord(
    loadStructuredFile(resolve(certsDir, 'zk-params.json')),
    'zk-params.json'
  );

  return {
    serverPublicParams: getRequiredStringValue(zkParams, 'publicParams'),
    serverTrustRoots: [getRequiredStringValue(trustRoot, 'publicKey')],
    genericServerPublicParams: getStringValue(zkParams, 'genericPublicParams'),
    backupServerPublicParams: getStringValue(zkParams, 'backupPublicParams'),
    source: {
      mode: 'mock-certs',
      mockCertsDir: certsDir,
      trustRootSource: resolve(certsDir, 'trust-root.json'),
    },
  };
}

function extractFromSignalServer(options: Options): ExtractedParams {
  if (!options.configPath) {
    throw new Error('Missing config path');
  }

  const configPath = resolvePath(options.configPath);
  const config = asRecord(loadStructuredFile(configPath), 'config');
  const secretsPath = options.secretsPath
    ? resolvePath(options.secretsPath)
    : undefined;
  const secrets = secretsPath
    ? asRecord(loadStructuredFile(secretsPath), 'secrets')
    : undefined;

  const configuredServerPublic = getStringValue(config, 'zkConfig.serverPublic');
  const configuredServerSecret = resolveSecretValue(
    getStringValue(config, 'zkConfig.serverSecret'),
    secrets,
    'zkConfig.serverSecret'
  );

  const serverPublicParams =
    configuredServerPublic ||
    (configuredServerSecret
      ? deriveServerPublicParams(configuredServerSecret)
      : undefined);

  if (!serverPublicParams) {
    throw new Error(
      'Could not determine serverPublicParams from zkConfig.serverPublic or zkConfig.serverSecret'
    );
  }

  let trustRoot:
    | Readonly<{
        key: string;
        source: string;
      }>
    | undefined;

  if (options.trustRootInput) {
    trustRoot = loadTrustRootFromInput(options.trustRootInput);
  } else if (options.trustRootKey) {
    if (!secrets) {
      throw new Error(
        '--trust-root-key requires a --secrets file so the key can be resolved'
      );
    }

    if (options.trustRootKey === 'unidentifiedDelivery.privateKey') {
      throw new Error(
        [
          'unidentifiedDelivery.privateKey is the private key used to sign sender certificates,',
          'not the trust-root key used by clients to validate the embedded server certificate.',
          'Pass the actual trust-root public/private key instead.',
        ].join(' ')
      );
    }

    const trustRootValue = getRequiredStringValue(secrets, options.trustRootKey);
    trustRoot = normalizeTrustRootValue(
      trustRootValue,
      `secrets:${options.trustRootKey}`
    );
  } else {
    const identifiedPrivateKey = resolveSecretValue(
      getStringValue(config, 'unidentifiedDelivery.privateKey'),
      secrets,
      'unidentifiedDelivery.privateKey'
    );

    throw new Error(
      [
        'Could not determine serverTrustRoots automatically.',
        'Official Signal-Server config stores unidentifiedDelivery.privateKey,',
        'but the client needs the trust-root public key that signed',
        'unidentifiedDelivery.certificate.',
        identifiedPrivateKey
          ? 'Pass --trust-root with the root public/private key, or --trust-root-key with the matching secret key.'
          : 'Pass --trust-root with the root public/private key, or --trust-root-key with the matching secret key.',
      ].join(' ')
    );
  }

  return {
    serverPublicParams,
    serverTrustRoots: [trustRoot.key],
    source: {
      mode: 'signal-server',
      configPath,
      secretsPath,
      trustRootSource: trustRoot.source,
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const extracted = options.mockCertsDir
    ? extractFromMockCerts(options.mockCertsDir)
    : extractFromSignalServer(options);

  const output = JSON.stringify(extracted, null, 2);

  if (options.outPath) {
    await writeFile(resolvePath(options.outPath), `${output}\n`, 'utf8');
  }

  console.log(output);
}

void main().catch(error => {
  console.error(
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`
  );
  process.exit(1);
});
