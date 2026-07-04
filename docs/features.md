# Features

## Local Browser Demo

The demo in [`demo/`](../demo/index.html) supports:

- realtime microphone streaming to the local websocket server
- local speaker playback of streamed assistant audio
- live user transcription and assistant transcript display
- webcam preview in the browser
- automatic per-turn webcam snapshot sharing on speech start
- manual snapshot sharing for the next turn
- editable session instructions and websocket endpoint
- local event logging for permission, websocket, and server errors

## Scope

This demo is intentionally small and browser-only:

- no authentication flow
- no tool execution loop in the browser
- no bundled HTTP server; serve `demo/` with a local static server
- no persistent conversation export
