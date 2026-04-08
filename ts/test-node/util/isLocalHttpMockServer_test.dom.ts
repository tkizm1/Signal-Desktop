// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { isLocalHttpMockServer } from '../../util/isLocalHttpMockServer.dom.ts';

describe('isLocalHttpMockServer', () => {
  it('returns true for remote mock servers over http', () => {
    assert.isTrue(isLocalHttpMockServer('http://5.175.220.72:8080'));
  });

  it('returns true for localhost over http', () => {
    assert.isTrue(isLocalHttpMockServer('http://localhost:8080'));
  });

  it('returns false for non-http servers', () => {
    assert.isFalse(isLocalHttpMockServer('https://5.175.220.72:8080'));
  });

  it('returns false for non-mock http servers', () => {
    assert.isFalse(isLocalHttpMockServer('http://chat.signal.org'));
  });
});
