// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  getCustomHostOverrides,
  getLocalServerPorts,
} from '../../textsecure/preconnect.preload.ts';

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

    it('uses localhost proxy defaults for remote https mock servers without explicit ports', () => {
      assert.deepEqual(
        getLocalServerPorts(
          'https://signal.tkisnnn.pp.ua',
          'https://localhost:8083'
        ),
        {
          chatPort: 8080,
          cdsiPort: 8083,
        }
      );
    });
  });

  describe('getCustomHostOverrides', () => {
    it('uses the remote https host directly for chat websocket connections', () => {
      assert.deepEqual(
        getCustomHostOverrides(
          'https://signal.tkisnnn.pp.ua',
          'https://localhost:8083'
        ),
        {
          chatHostname: 'signal.tkisnnn.pp.ua',
          chatPort: 443,
        }
      );
    });

    it('includes a remote https CDSI override when directoryUrl is also remote', () => {
      assert.deepEqual(
        getCustomHostOverrides(
          'https://signal.tkisnnn.pp.ua:8443',
          'https://5.175.220.72:8083'
        ),
        {
          chatHostname: 'signal.tkisnnn.pp.ua',
          chatPort: 8443,
          cdsiHostname: '5.175.220.72',
          cdsiPort: 8083,
        }
      );
    });
  });
});
