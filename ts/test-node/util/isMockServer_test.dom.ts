// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { isMockServer } from '../../util/isMockServer.dom.ts';

describe('isMockServer', () => {
  it('returns true for configured remote mock server domains', () => {
    assert.isTrue(isMockServer('https://api.xufu.ai'));
    assert.isTrue(isMockServer('https://signal.tkisnnn.pp.ua'));
  });

  it('returns false for non-mock remote domains', () => {
    assert.isFalse(isMockServer('https://chat.signal.org'));
  });
});
