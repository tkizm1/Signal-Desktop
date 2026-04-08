// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { isMockServer } from './isMockServer.dom.ts';
import { maybeParseUrl } from './url.std.ts';

export function isLocalHttpMockServer(
  serverUrl = window.SignalContext.config.serverUrl
): boolean {
  const parsedServerUrl = maybeParseUrl(serverUrl);

  return parsedServerUrl?.protocol === 'http:' && isMockServer(serverUrl);
}
