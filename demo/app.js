const elements = {
  endpoint: document.querySelector("#endpoint"),
  instructions: document.querySelector("#instructions"),
  connect: document.querySelector("#connect"),
  disconnect: document.querySelector("#disconnect"),
  snapshot: document.querySelector("#snapshot"),
  cameraContext: document.querySelector("#camera-context"),
  status: document.querySelector("#status"),
  preview: document.querySelector("#preview"),
  snapshotMeta: document.querySelector("#snapshot-meta"),
  userText: document.querySelector("#user-text"),
  assistantText: document.querySelector("#assistant-text"),
  log: document.querySelector("#log"),
};

const state = {
  websocket: null,
  mediaStream: null,
  audioContext: null,
  micSource: null,
  micProcessor: null,
  micSilencer: null,
  playbackGain: null,
  nextPlaybackAt: 0,
  sessionConfigured: false,
  stopping: false,
};

const SNAPSHOT_WIDTH = 640;
const SNAPSHOT_QUALITY = 0.72;
const TARGET_SAMPLE_RATE = 16000;

function logLine(message) {
  const stamp = new Date().toLocaleTimeString();
  elements.log.textContent += `[${stamp}] ${message}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setStatus(text, variant) {
  elements.status.textContent = text;
  elements.status.className = `status ${variant}`;
}

function setControls(connected) {
  elements.connect.disabled = connected;
  elements.disconnect.disabled = !connected;
  elements.snapshot.disabled = !connected;
}

function setUserText(text) {
  elements.userText.textContent = text;
}

function setAssistantText(text) {
  elements.assistantText.textContent = text;
}

function websocketReady() {
  return state.websocket && state.websocket.readyState === WebSocket.OPEN;
}

function sendEvent(event) {
  if (!websocketReady()) {
    return;
  }
  state.websocket.send(JSON.stringify(event));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function resampleFloat32(input, fromRate, toRate) {
  if (fromRate === toRate) {
    return input;
  }

  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[index] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

function floatToInt16Bytes(input) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, int16, true);
  }

  return bytes;
}

function decodePcm16(base64Value) {
  const bytes = base64ToBytes(base64Value);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return samples;
}

function configureSession() {
  sendEvent({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: elements.instructions.value.trim(),
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            interrupt_response: true,
          },
        },
      },
    },
  });
  state.sessionConfigured = true;
  logLine("Sent session.update.");
}

function shareSnapshot(reason) {
  if (!websocketReady() || !state.mediaStream) {
    return;
  }

  const video = elements.preview;
  if (!video.videoWidth || !video.videoHeight) {
    logLine("Skipping snapshot because the camera preview is not ready yet.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * SNAPSHOT_WIDTH);

  const context = canvas.getContext("2d");
  if (!context) {
    logLine("Skipping snapshot because the canvas context is unavailable.");
    return;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageUrl = canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY);

  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_image",
          image_url: imageUrl,
          detail: "low",
        },
      ],
    },
  });

  elements.snapshotMeta.textContent = `Latest snapshot shared ${new Date().toLocaleTimeString()} (${reason}).`;
  logLine(`Shared webcam snapshot for ${reason}.`);
}

function queuePlayback(base64Audio) {
  if (!state.audioContext || !state.playbackGain) {
    return;
  }

  const samples = decodePcm16(base64Audio);
  const buffer = state.audioContext.createBuffer(1, samples.length, TARGET_SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);

  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.playbackGain);

  const startAt = Math.max(state.audioContext.currentTime, state.nextPlaybackAt);
  source.start(startAt);
  state.nextPlaybackAt = startAt + buffer.duration;
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    case "session.created":
      logLine("Session created.");
      if (!state.sessionConfigured) {
        configureSession();
      }
      break;
    case "input_audio_buffer.speech_started":
      setStatus("Listening", "live");
      if (elements.cameraContext.checked) {
        shareSnapshot("the current turn");
      }
      break;
    case "input_audio_buffer.speech_stopped":
      setStatus("Processing", "connecting");
      break;
    case "conversation.item.input_audio_transcription.delta":
      setUserText(event.delta || "Listening...");
      break;
    case "conversation.item.input_audio_transcription.completed":
      setUserText(event.transcript || "No transcript returned.");
      logLine(`User transcript: ${event.transcript || "<empty>"}`);
      break;
    case "response.created":
      setAssistantText("Generating audio response...");
      break;
    case "response.output_audio.delta":
      queuePlayback(event.delta);
      break;
    case "response.output_audio_transcript.done":
      setAssistantText(event.transcript || "Assistant responded with audio only.");
      logLine(`Assistant transcript: ${event.transcript || "<empty>"}`);
      break;
    case "response.done":
      state.nextPlaybackAt = 0;
      setStatus("Connected", "live");
      break;
    case "error":
      setStatus("Server error", "error");
      logLine(`Server error: ${event.error?.type || "unknown"} - ${event.error?.message || "No message"}`);
      break;
    default:
      break;
  }
}

async function stopSession() {
  if (state.stopping) {
    return;
  }

  state.stopping = true;

  if (state.websocket) {
    const socket = state.websocket;
    state.websocket = null;
    socket.close();
  }

  if (state.micSource) {
    state.micSource.disconnect();
    state.micSource = null;
  }

  if (state.micProcessor) {
    state.micProcessor.disconnect();
    state.micProcessor.onaudioprocess = null;
    state.micProcessor = null;
  }

  if (state.micSilencer) {
    state.micSilencer.disconnect();
    state.micSilencer = null;
  }

  if (state.playbackGain) {
    state.playbackGain.disconnect();
    state.playbackGain = null;
  }

  if (state.audioContext) {
    if (state.audioContext.state !== "closed") {
      await state.audioContext.close();
    }
    state.audioContext = null;
  }

  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) {
      track.stop();
    }
    state.mediaStream = null;
  }

  elements.preview.srcObject = null;
  state.sessionConfigured = false;
  state.nextPlaybackAt = 0;
  setControls(false);
  setStatus("Idle", "idle");
  setUserText("Waiting for microphone input.");
  setAssistantText("Waiting for server output.");
  state.stopping = false;
}

async function startSession() {
  if (websocketReady() || state.websocket || state.stopping) {
    return;
  }

  try {
    elements.connect.disabled = true;
    setStatus("Connecting", "connecting");
    logLine("Requesting microphone and camera permissions.");

    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    elements.preview.srcObject = state.mediaStream;

    state.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    await state.audioContext.resume();

    state.playbackGain = state.audioContext.createGain();
    state.playbackGain.connect(state.audioContext.destination);

    state.micSource = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.micProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
    state.micSilencer = state.audioContext.createGain();
    state.micSilencer.gain.value = 0;

    state.micProcessor.onaudioprocess = (audioEvent) => {
      if (!websocketReady()) {
        return;
      }
      const input = audioEvent.inputBuffer.getChannelData(0);
      const resampled = resampleFloat32(input, audioEvent.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
      const pcmBytes = floatToInt16Bytes(resampled);
      sendEvent({
        type: "input_audio_buffer.append",
        audio: bytesToBase64(pcmBytes),
      });
    };

    state.micSource.connect(state.micProcessor);
    state.micProcessor.connect(state.micSilencer);
    state.micSilencer.connect(state.audioContext.destination);

    const endpoint = elements.endpoint.value.trim();
    state.websocket = new WebSocket(endpoint);

    state.websocket.addEventListener("open", () => {
      setControls(true);
      setStatus("Connected", "live");
      logLine(`Connected to ${endpoint}.`);
    });

    state.websocket.addEventListener("message", (messageEvent) => {
      const event = JSON.parse(messageEvent.data);
      handleRealtimeEvent(event);
    });

    state.websocket.addEventListener("close", () => {
      logLine("WebSocket closed.");
      stopSession();
    });

    state.websocket.addEventListener("error", () => {
      setStatus("Connection failed", "error");
      logLine("WebSocket error.");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine(`Startup failed: ${message}`);
    setStatus("Startup failed", "error");
    await stopSession();
  }
}

elements.connect.addEventListener("click", () => {
  startSession();
});

elements.disconnect.addEventListener("click", () => {
  stopSession();
});

elements.snapshot.addEventListener("click", () => {
  shareSnapshot("manual share");
});

setControls(false);
setStatus("Idle", "idle");
