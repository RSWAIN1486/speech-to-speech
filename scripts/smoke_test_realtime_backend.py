#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import base64
import wave
from pathlib import Path

from openai import AsyncOpenAI


PIPELINE_SAMPLE_RATE = 16000


def make_client(host: str, port: int, api_key: str) -> AsyncOpenAI:
    base_url = f"http://{host}:{port}/v1"
    websocket_base_url = f"ws://{host}:{port}/v1"
    return AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        websocket_base_url=websocket_base_url,
    )


def build_session_update(instructions: str | None, voice: str | None) -> dict:
    output_cfg: dict = {}
    if voice:
        output_cfg["voice"] = voice
    session = {
        "type": "realtime",
        "audio": {
            "input": {
                "turn_detection": {"type": "server_vad", "interrupt_response": True},
            },
            "output": output_cfg,
        },
    }
    if instructions:
        session["instructions"] = instructions
    return {"type": "session.update", "session": session}


def write_wav(path: Path, pcm16_bytes: bytes, rate: int = PIPELINE_SAMPLE_RATE) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(rate)
        wav_file.writeframes(pcm16_bytes)


async def recv_event(conn, timeout_s: float):
    return await asyncio.wait_for(conn.recv(), timeout=timeout_s)


async def run_smoke_test(args: argparse.Namespace) -> int:
    client = make_client(args.host, args.port, args.api_key)
    audio_bytes = bytearray()
    transcript_parts: list[str] = []
    saw_item_created = False
    saw_response_created = False
    saw_audio_delta = False
    saw_response_done = False

    async with client.realtime.connect(model=args.model) as conn:
        event = await recv_event(conn, args.timeout)
        print(f"Connected: {event.type}")

        await conn.send(build_session_update(args.instructions, args.voice))

        await conn.send(
            {
                "type": "conversation.item.create",
                "item": {
                    "id": "msg_smoke_text_1",
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": args.prompt}],
                },
            }
        )

        while True:
            event = await recv_event(conn, args.timeout)
            event_type = event.type
            print(f"Event: {event_type}")

            if event_type == "conversation.item.created":
                saw_item_created = True
                await conn.send({"type": "response.create"})
            elif event_type == "response.created":
                saw_response_created = True
            elif event_type == "response.output_audio.delta":
                delta = getattr(event, "delta", None)
                if delta:
                    saw_audio_delta = True
                    audio_bytes.extend(base64.b64decode(delta))
            elif event_type == "response.output_audio_transcript.done":
                transcript = getattr(event, "transcript", None)
                if transcript:
                    transcript_parts.append(transcript)
            elif event_type == "response.done":
                saw_response_done = True
                break
            elif event_type == "error":
                err = getattr(event, "error", None)
                print(f"Server error: {err}")
                return 1

    transcript = " ".join(part.strip() for part in transcript_parts if part.strip()).strip()
    print()
    print(f"Transcript: {transcript or '<none>'}")
    print(f"Audio bytes: {len(audio_bytes)}")

    if args.output_wav and audio_bytes:
        write_wav(args.output_wav, bytes(audio_bytes))
        print(f"Saved audio to: {args.output_wav}")

    if not saw_item_created:
        print("Smoke test failed: no conversation.item.created event received.")
        return 1
    if not saw_response_created:
        print("Smoke test failed: no response.created event received.")
        return 1
    if not saw_audio_delta:
        print("Smoke test failed: no response.output_audio.delta event received.")
        return 1
    if not saw_response_done:
        print("Smoke test failed: no response.done event received.")
        return 1

    print("Realtime smoke test completed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the local realtime websocket backend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--model", default="local")
    parser.add_argument("--api-key", default="local-api-key")
    parser.add_argument(
        "--prompt",
        default="Please say exactly: realtime smoke test successful.",
    )
    parser.add_argument(
        "--instructions",
        default="Be concise and follow the user's wording closely.",
    )
    parser.add_argument("--voice", default=None)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--output-wav",
        type=Path,
        default=Path("tmp/realtime-smoke-output.wav"),
    )
    args = parser.parse_args()

    if args.output_wav:
        args.output_wav.parent.mkdir(parents=True, exist_ok=True)

    return asyncio.run(run_smoke_test(args))


if __name__ == "__main__":
    raise SystemExit(main())
