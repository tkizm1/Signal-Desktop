// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { isLoopbackMockServer } from './isLoopbackMockServer.dom.ts';
import { maybeParseUrl } from './url.std.ts';

export function shouldBypassLocalHttpWebSocket(
  serverUrl = window.SignalContext.config.serverUrl,
  enableLocalHttpWebSocket =
    window.SignalContext.config.enableLocalHttpWebSocket
): boolean {
  const parsedServerUrl = maybeParseUrl(serverUrl);

  return (
    parsedServerUrl?.protocol === 'http:' &&
    isLoopbackMockServer(serverUrl) &&
    !enableLocalHttpWebSocket
  );
}
