#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import sys
import urllib.error
import urllib.request
from pathlib import Path


def file_to_data_url(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type is None:
        mime_type = "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def post_json(url: str, payload: dict, api_key: str) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_text(response: dict) -> str:
    choices = response.get("choices") or []
    if not choices:
        return json.dumps(response, indent=2)
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if text:
                    parts.append(text)
        if parts:
            return "\n".join(parts)
    return json.dumps(message, indent=2)


def run_text_test(base_url: str, model: str, api_key: str) -> None:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly: text-ok",
            }
        ],
        "max_tokens": 32,
        "temperature": 0,
    }
    response = post_json(f"{base_url}/chat/completions", payload, api_key)
    print("== Text test ==")
    print(extract_text(response).strip())
    print()


def run_image_test(base_url: str, model: str, api_key: str, image_path: Path) -> None:
    image_url = file_to_data_url(image_path)
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Briefly describe this image in one sentence and include the token image-ok.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                ],
            }
        ],
        "max_tokens": 96,
        "temperature": 0,
    }
    response = post_json(f"{base_url}/chat/completions", payload, api_key)
    print("== Image test ==")
    print(f"Image: {image_path}")
    print(extract_text(response).strip())
    print()


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Smoke-test a local vLLM Gemma chat/completions server with text and image input."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
    parser.add_argument("--model", default="google/gemma-4-E4B-it")
    parser.add_argument("--api-key", default="local-api-key")
    parser.add_argument("--image", type=Path, default=repo_root / "logo.png")
    parser.add_argument("--skip-image", action="store_true")
    args = parser.parse_args()

    try:
        run_text_test(args.base_url.rstrip("/"), args.model, args.api_key)
        if not args.skip_image:
            if not args.image.exists():
                raise FileNotFoundError(f"Image file not found: {args.image}")
            run_image_test(args.base_url.rstrip("/"), args.model, args.api_key, args.image)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code} from server:\n{body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Could not reach server at {args.base_url}: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        return 1

    print("Smoke test completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
