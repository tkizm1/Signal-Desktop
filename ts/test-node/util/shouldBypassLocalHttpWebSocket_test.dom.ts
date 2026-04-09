// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { shouldBypassLocalHttpWebSocket } from '../../util/shouldBypassLocalHttpWebSocket.dom.ts';

describe('shouldBypassLocalHttpWebSocket', () => {
  it('returns true for localhost over http', () => {
    assert.isTrue(shouldBypassLocalHttpWebSocket('http://localhost:8080'));
  });

  it('returns true for loopback ip over http', () => {
    assert.isTrue(shouldBypassLocalHttpWebSocket('http://127.0.0.1:8080'));
  });

  it('returns false for remote mock servers over http', () => {
    assert.isFalse(shouldBypassLocalHttpWebSocket('http://5.175.220.72:8080'));
  });

  it('returns false for localhost over http when local websocket is enabled', () => {
    assert.isFalse(
      shouldBypassLocalHttpWebSocket('http://localhost:8080', true)
    );
  });

  it('returns false for non-http loopback servers', () => {
    assert.isFalse(shouldBypassLocalHttpWebSocket('https://localhost:8080'));
  });
});
