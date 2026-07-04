# Progress

## Completed
- Added a local browser demo for realtime microphone + webcam chat against `/v1/realtime`.
- Documented the arm64 Python requirement for MLX-based multimodal inference.
- Documented the recommended local Mac launch profile using an MLX VLM and Kokoro TTS.
- Added `torchvision` to the macOS `mlx-lm` extra so the Qwen2.5-VL processor stack loads cleanly.
- Added the missing `num2words` runtime dependency for Kokoro TTS on macOS and clarified the import error path.
- Fixed MLX Qwen2.5-VL prompt formatting so realtime turns fall back to the tokenizer chat template when the processor template is missing.

## In Progress
- First-run local startup still requires large model downloads for STT and the vision model.

## Decisions
- The browser sends one webcam snapshot per spoken turn on `speech_started` instead of continuously streaming video frames.
- The demo uses a separate static page in `demo/` instead of changing the backend server surface.

## Blockers
- None in the repo itself. Local runtime still depends on camera and microphone permissions plus the initial model downloads.
