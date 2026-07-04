# Architecture

## Realtime Local Browser Demo

The repository now includes a browser demo in [`demo/`](../demo/index.html) for local multimodal chat against the existing OpenAI Realtime-compatible backend.

Current flow:

1. A local `speech-to-speech` server exposes `ws://<host>:<port>/v1/realtime`.
2. The browser demo captures microphone audio with Web Audio, downsamples it to 16 kHz PCM16, and sends `input_audio_buffer.append` events over the websocket.
3. When `input_audio_buffer.speech_started` arrives from the server and camera context is enabled, the browser captures one webcam frame and injects it as a `conversation.item.create` user message with `input_image`.
4. The backend STT transcribes the spoken turn, the MLX vision-language model sees the latest injected frame plus the transcript, and TTS streams audio deltas back to the browser.
5. The browser decodes `response.output_audio.delta` PCM chunks and plays them through the local speakers while showing transcript events in the UI.

## Local Mac Requirement

The MLX-based multimodal path requires an arm64 Python interpreter. An x86_64 Python running under Rosetta will fail to install `mlx` and `mlx-vlm`.

The current Qwen2.5-VL path also depends on `torchvision` because the processor stack loaded by `transformers` includes the Qwen video processor classes even when the browser demo only sends still images.

## Recommended Local Profile

For the browser demo, the current recommended local stack is:

- `--mode realtime`
- `--device mps`
- `--stt parakeet-tdt`
- `--llm_backend mlx-lm`
- `--llm_is_vlm True`
- `--model_name mlx-community/Qwen2.5-VL-3B-Instruct-4bit`
- `--tts kokoro`
