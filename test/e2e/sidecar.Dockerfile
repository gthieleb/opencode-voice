# voice-sidecar image for the R0.2 container e2e stack: repo lib + launcher
# only, no whisper, no model, no build step.
FROM node:24-slim

WORKDIR /app

# deps first for layer caching. npm ci WITHOUT --omit=dev is intentional:
# ws lives in devDependencies (task 4c note: "runtime resolution must be
# guaranteed"), so --omit=dev would break `import { WebSocket } from "ws"`
# in lib/web-transport.js. we keep the full dev tree (oxlint, playwright pkg,
# solid-js) instead of pruning or cherry-picking: plain `npm ci` is the only
# lockfile-pure, reproducible acquisition of ws here.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# runtime code: the transport (plus its imports audio-validate.js, stt.js)
# and the launcher
COPY lib/ lib/
COPY bin/ bin/

ENV VOICE_PORT=9100
ENV VOICE_TMPDIR=/tmp/voice
EXPOSE 9100

# FAKE_TRANSCRIBE is set per-environment (compose sets 1 for the smoke stack);
# unset here means the real transcribeWavFile pipeline (needs whisper-cli +
# a model inside the image, out of MVP scope)
CMD ["node", "bin/voice-sidecar.js"]
