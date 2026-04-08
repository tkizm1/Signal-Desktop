// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { getLocalServerPorts } from '../../textsecure/preconnect.preload.ts';

describe('preconnect', () => {
  describe('getLocalServerPorts', () => {
    it('uses directoryUrl port for local CDSI', () => {
      assert.deepEqual(
        getLocalServerPorts(
          'http://5.175.220.72:8080',
          'http://localhost:8082'
        ),
        {
          chatPort: 8080,
          cdsiPort: 8082,
        }
      );
    });

    it('falls back to discard port when CDSI is not local', () => {
      assert.deepEqual(
        getLocalServerPorts(
          'http://5.175.220.72:8080',
          'https://cdsi.staging.signal.org'
        ),
        {
          chatPort: 8080,
          cdsiPort: 9,
        }
      );
    });
  });
});
