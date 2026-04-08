// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { Net } from '@signalapp/libsignal-client';

import { getUserAgent } from '../util/getUserAgent.node.ts';
import { isStagingServer } from '../util/isStagingServer.dom.ts';
import { getMockServerPort } from '../util/getMockServerPort.dom.ts';
import { isMockServer } from '../util/isMockServer.dom.ts';
import { isLocalHttpMockServer } from '../util/isLocalHttpMockServer.dom.ts';
import { pemToDer } from '../util/pemToDer.std.ts';
import { maybeParseUrl } from '../util/url.std.ts';
import { drop } from '../util/drop.std.ts';
import { toLogFormat } from '../types/errors.std.ts';
import { createLogger } from '../logging/log.std.ts';

const log = createLogger('preconnect');
const DISCARD_PORT = 9; // Reserved by RFC 863.

export function getLocalServerPorts(
  chatServiceUrl: string,
  directoryUrl: string
): Readonly<{
  chatPort: number;
  cdsiPort: number;
}> {
  return {
    chatPort: parseInt(getMockServerPort(chatServiceUrl), 10),
    cdsiPort: isMockServer(directoryUrl)
      ? parseInt(getMockServerPort(directoryUrl), 10)
      : DISCARD_PORT,
  };
}

// Libsignal has internally configured values for domain names
// (and other connectivity params) of the services.
function resolveLibsignalNet(
  chatServiceUrl: string,
  directoryUrl: string,
  version: string,
  certificateAuthority?: string
): Net.Net {
  const userAgent = getUserAgent(version);
  log.info(`libsignal net url: ${chatServiceUrl}`);
  if (isStagingServer(chatServiceUrl)) {
    log.info('libsignal net environment resolved to staging');
    return new Net.Net({
      env: Net.Environment.Staging,
      userAgent,
    });
  }

  if (isMockServer(chatServiceUrl)) {
    const parsedChatUrl = maybeParseUrl(chatServiceUrl);
    const parsedDirectoryUrl = maybeParseUrl(directoryUrl);
    const isLocalHttp =
      parsedChatUrl?.protocol === 'http:' ||
      parsedDirectoryUrl?.protocol === 'http:';
    const { chatPort, cdsiPort } = getLocalServerPorts(
      chatServiceUrl,
      directoryUrl
    );
    log.info('libsignal net environment resolved to mock');
    return new Net.Net({
      localTestServer: true,
      userAgent,
      TESTING_localServer_chatPort: chatPort,
      TESTING_localServer_cdsiPort: cdsiPort,
      TESTING_localServer_svr2Port: DISCARD_PORT,
      TESTING_localServer_svrBPort: DISCARD_PORT,
      TESTING_localServer_rootCertificateDer:
        certificateAuthority && !isLocalHttp
          ? pemToDer(certificateAuthority)
          : new Uint8Array(new ArrayBuffer(0)),
      TESTING_localServer_httpVersion: isLocalHttp ? 1 : undefined,
    });
  }

  log.info('libsignal net environment resolved to prod');
  return new Net.Net({
    env: Net.Environment.Production,
    userAgent,
  });
}

// `libsignalNet` is an instance of a class from libsignal that is responsible
// for providing network layer API and related functionality.
// It's important to have a single instance of this class as it holds
// resources that are shared across all other use cases.
let libsignalNet: Net.Net;

export function getLibsignalNet(): Net.Net {
  return libsignalNet;
}

// Not defined in tests
if (
  typeof window !== 'undefined' &&
  window.SignalContext.config?.serverUrl &&
  window.SignalContext.config.directoryConfig?.directoryUrl
) {
  const { config } = window.SignalContext;

  libsignalNet = resolveLibsignalNet(
    config.serverUrl,
    config.directoryConfig.directoryUrl,
    config.version,
    config.certificateAuthority
  );

  libsignalNet.setIpv6Enabled(!config.disableIPv6);
  if (config.proxyUrl) {
    log.info('WebAPI: Setting libsignal proxy');
    try {
      libsignalNet.setProxyFromUrl(config.proxyUrl);
    } catch (error) {
      log.error(`WebAPI: Failed to set proxy: ${error}`);
      libsignalNet.clearProxy();
    }
  }

  drop(
    (async () => {
      try {
        if (isLocalHttpMockServer(config.serverUrl)) {
          log.info(
            'WebAPI: skipping libsignal chat preconnect for local HTTP chat service'
          );
          return;
        }
        log.info('WebAPI: preconnect start');
        await libsignalNet.preconnectChat();
        log.info('WebAPI: preconnect done');
      } catch (error) {
        log.error(`WebAPI: Failed to preconnect: ${toLogFormat(error)}`);
      }
    })()
  );
}
