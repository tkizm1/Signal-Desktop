#!/usr/bin/env python3
import argparse
import json
import mimetypes
import sys
import urllib.error
import urllib.parse
import urllib.request


def load_response(args: argparse.Namespace) -> dict:
    if args.response:
        return json.loads(args.response)
    if args.response_file:
        with open(args.response_file, "r", encoding="utf-8") as f:
            return json.load(f)
    raise ValueError("one of --response or --response-file is required")


def make_request(
    url: str,
    method: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
) -> urllib.request.Request:
    req = urllib.request.Request(url=url, data=data, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    return req


def do_request(
    req: urllib.request.Request,
) -> tuple[int, dict[str, str], bytes]:
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Simulate Signal attachment upload from attachmentUploadForm response JSON."
    )
    parser.add_argument(
        "--response", help="Raw JSON string from attachment upload form response."
    )
    parser.add_argument(
        "--response-file",
        help="Path to a JSON file containing the attachment upload form response.",
    )
    parser.add_argument(
        "--file",
        required=True,
        help="File to upload.",
    )
    parser.add_argument(
        "--content-type",
        help="Override Content-Type for upload body.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print response bodies in addition to status and headers.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    response = load_response(args)

    signed_upload_location = response["signedUploadLocation"]
    upload_headers = dict(response.get("headers", {}))

    with open(args.file, "rb") as f:
        payload = f.read()

    content_type = args.content_type
    if not content_type:
        content_type, _ = mimetypes.guess_type(args.file)
    if not content_type:
        content_type = "application/octet-stream"

    print("== attachment upload form ==")
    print(f"cdn: {response['cdn']}")
    print()

    print("== step 1: POST signedUploadLocation ==")
    post_req = make_request(
        signed_upload_location,
        "POST",
        headers=upload_headers,
        data=b"",
    )
    post_status, post_resp_headers, post_body = do_request(post_req)
    print(f"status: {post_status}")
    print("headers:")
    print(json.dumps(post_resp_headers, ensure_ascii=False, indent=2))
    if args.verbose and post_body:
        print("body:")
        print(post_body.decode("utf-8", errors="replace"))
    print()

    upload_location = next(
        (value for key, value in post_resp_headers.items() if key.lower() == "location"),
        None,
    )
    if not upload_location:
        print("No Location header found in POST response.", file=sys.stderr)
        return 2
    upload_location = urllib.parse.urljoin(signed_upload_location, upload_location)

    print("== step 2: PUT uploadLocation ==")
    print(f"uploadLocation: {upload_location}")
    put_headers = {
        "Content-Range": f"bytes 0-*/{len(payload)}",
        "Content-Type": content_type,
        "Content-Length": str(len(payload)),
    }
    put_req = make_request(
        upload_location,
        "PUT",
        headers=put_headers,
        data=payload,
    )
    put_status, put_resp_headers, put_body = do_request(put_req)
    print(f"status: {put_status}")
    print("headers:")
    print(json.dumps(put_resp_headers, ensure_ascii=False, indent=2))
    if args.verbose and put_body:
        print("body:")
        print(put_body.decode("utf-8", errors="replace"))
    print()

    if 200 <= put_status < 300:
        print("Upload finished successfully.")
        return 0

    print("Upload did not succeed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
