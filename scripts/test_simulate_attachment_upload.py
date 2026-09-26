import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import simulate_attachment_upload as upload


class UploadTest(unittest.TestCase):
    def test_uses_response_location_without_printing_auth_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.txt"
            path.write_bytes(b"sample")
            response = {
                "cdn": 3,
                "signedUploadLocation": "https://example.test/attachments/",
                "headers": {"Authorization": "Bearer secret"},
            }
            requests = []

            def request(req):
                requests.append(req)
                if len(requests) == 1:
                    return 201, {"location": "/upload/123"}, b""
                return 200, {}, b""

            output = io.StringIO()
            with patch.object(sys, "argv", ["upload", "--response", json.dumps(response), "--file", str(path)]), patch.object(upload, "do_request", side_effect=request), contextlib.redirect_stdout(output):
                self.assertEqual(upload.main(), 0)

            self.assertEqual(requests[0].get_header("Authorization"), "Bearer secret")
            self.assertEqual(requests[1].full_url, "https://example.test/upload/123")
            self.assertEqual(requests[1].data, b"sample")
            self.assertNotIn("Bearer secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
