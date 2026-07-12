# Local Browser Demo

## 1. Use an arm64 Python

On Apple Silicon, confirm that `python` is arm64 before creating the environment. A Rosetta/x86_64 interpreter will fail when `mlx` installs.

Example working interpreter:

```bash
/opt/homebrew/bin/python3.12 -c "import platform; print(platform.machine())"
```

Expected output:

```text
arm64
```

## 2. Install the repo with MLX vision support

```bash
uv sync --python /opt/homebrew/bin/python3.12 --extra mlx-lm --dev
```

This installs:

- `mlx`
- `mlx-lm`
- `mlx-vlm`
- `torchvision`
- `num2words`
- the editable `speech-to-speech` package

## 3. Start the realtime backend

The default port `8765` may already be in use on your machine, so this demo uses `8876`.

```bash
.venv/bin/speech-to-speech \
  --mode realtime \
  --ws_port 8876 \
  --device mps \
  --stt parakeet-tdt \
  --llm_backend mlx-lm \
  --llm_is_vlm True \
  --model_name mlx-community/Qwen3-VL-8B-Instruct-4bit \
  --tts kokoro \
  --log_level info
```

Notes:

- First launch downloads the STT model and the VLM from Hugging Face.
- The repository will also fetch the NLTK tokenizers the first time `speech-to-speech` starts.
- `DeepFilterNet` is optional; the startup warning about it being unavailable is not fatal for this demo.
- `mlx-community/Qwen3-VL-8B-Instruct-4bit` is heavier than the earlier Qwen2.5-VL 3B profile. If you hit memory pressure or very slow first-token latency, try `mlx-community/Qwen3-VL-8B-Instruct-3bit`.

## 4. Serve the browser client

From the repo root:

```bash
python3 -m http.server 8000 -d demo
```

Then open:

```text
http://127.0.0.1:8000
```

## 5. Use the demo

1. Click `Connect`.
2. Allow microphone and camera permissions in the browser.
3. Leave `Auto-share webcam frame at speech start` enabled if you want the assistant to see the current camera view on each spoken turn.
4. Speak naturally. The browser will stream audio continuously and inject one fresh webcam frame when the server signals speech start.
5. Use `Share Snapshot` when you want to refresh camera context before the next turn without waiting for a new speech-start event.

## 6. What to expect

- `User` shows live transcription events from the backend.
- `Assistant` shows the returned transcript for the spoken reply.
- Audio playback is streamed from `response.output_audio.delta`.
- The event log is the first place to look for websocket or permission failures.

## 7. Remote GPU Variant

The websocket endpoint is editable in the demo UI, so the browser can talk to a remote realtime backend instead of a local one.

For the current single-GPU AWS path that keeps the browser on your Mac and runs Gemma 4 E4B remotely, see [aws-g6-gemma4-e4b.md](./aws-g6-gemma4-e4b.md).
