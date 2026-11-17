# voice-sidecar image for the R0.2 container e2e stack: repo lib + launcher
# only, no whisper, no model, no build step.
FROM node:24-slim

WORKDIR /app

# deps first for layer caching. ws is a real runtime dependency now (it moved
# from devDependencies after a packed-tarball install proved the missing
# module), so --omit=dev would still resolve it. We keep plain `npm ci`
# without the flag anyway: it is the lockfile-pure acquisition path this image
# always used, and changing the flag is not needed for correctness.
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
