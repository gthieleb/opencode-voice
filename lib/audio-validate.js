// server-side wav gate: parse + validate, never throws, stable reason codes
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 mib
const DEFAULT_MIN_DURATION_MS = 300;
const DEFAULT_MAX_DURATION_MS = 120000;
const DEFAULT_SAMPLE_RATES = [16000];
const SILENCE_EPSILON = 1e-5; // fraction of full scale

// read a u32/u16 without going past the end; null if truncated
function readU32(buf, off, little) {
  if (off + 4 > buf.length) return null;
  return little ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
}
function readU16(buf, off) {
  if (off + 2 > buf.length) return null;
  return buf.readUInt16LE(off);
}

// rms of mid window as fraction of full scale; false if no samples
function midWindowRmsJack(pcm, bits) {
  const bytesPer = bits >> 3;
  const n = Math.floor(pcm.length / bytesPer);
  if (n === 0) return null;
  const maxWindow = 4800; // ~300 ms at 16k mono; cap regardless of rate
  const start = Math.floor(n / 2 - Math.min(maxWindow, n) / 2);
  const len = Math.floor(n / 2 + Math.min(maxWindow, n) / 2) - start;
  let sum = 0;
  for (let i = start; i < start + len; i++) {
    const s =
      bits === 16 ? pcm.readInt16LE(i * bytesPer) / 32768 : pcm.readUInt8(i * bytesPer) / 255; // only 16-bit used in practice
    sum += s * s;
  }
  return Math.sqrt(sum / len);
}

export function parseWav(buffer) {
  // total size cap
  if (buffer.length < 12)
    return {
      ok: false,
      reason: "TOO_SHORT",
      detail: `file is ${buffer.length} bytes, need riff header`,
    };
  if (buffer.toString("latin1", 0, 4) !== "RIFF")
    return { ok: false, reason: "NOT_RIFF", detail: "missing riff magic" };
  if (buffer.toString("latin1", 8, 12) !== "WAVE")
    return { ok: false, reason: "NOT_WAVE", detail: "missing wave magic" };

  // walk chunks, defensive against malformed sizes
  let off = 12;
  let fmt = null;
  let dataStart = -1;
  let dataDeclared = 0;
  while (off + 8 <= buffer.length) {
    const id = buffer.toString("latin1", off, off + 4);
    const size = readU32(buffer, off + 4, true);
    if (size === null) return { ok: false, reason: "TOO_SHORT", detail: "truncated chunk header" };
    const body = off + 8;
    if (body + size > buffer.length) {
      // clipped data chunk: accept if fmt known, silence probe uses available bytes
      if (id === "data" && fmt && body < buffer.length) {
        dataStart = body;
        dataDeclared = size;
        break;
      }
      return {
        ok: false,
        reason: "TOO_SHORT",
        detail: `chunk ${id} claims ${size} bytes past end`,
      };
    }
    if (id === "fmt " && !fmt) {
      const audioFormat = readU16(buffer, body);
      const channels = readU16(buffer, body + 2);
      const sampleRate = readU32(buffer, body + 4, true);
      const bitsPerSample = readU16(buffer, body + 14);
      if (
        audioFormat === null ||
        channels === null ||
        sampleRate === null ||
        bitsPerSample === null
      )
        return { ok: false, reason: "TOO_SHORT", detail: "truncated fmt chunk" };
      fmt = {
        audioFormat,
        channels,
        sampleRate,
        bitsPerSample,
        blockAlign: readU16(buffer, body + 12),
      };
    } else if (id === "data" && dataStart < 0) {
      dataStart = body;
      dataDeclared = size;
    }
    if (id === "data" && dataStart >= 0 && fmt) break; // data is last chunk for our purposes
    off = body + size + (size % 2); // chunks are even-aligned (rfc 2361)
  }
  if (!fmt) return { ok: false, reason: "NOT_WAVE", detail: "no fmt chunk" };
  if (fmt.audioFormat !== 1)
    return { ok: false, reason: "NOT_PCM", detail: `audio format ${fmt.audioFormat}, want pcm 1` };
  if (fmt.bitsPerSample !== 16)
    return {
      ok: false,
      reason: "NOT_S16",
      detail: `bits per sample ${fmt.bitsPerSample}, want 16`,
    };
  if (fmt.channels !== 1)
    return { ok: false, reason: "NOT_MONO", detail: `channels ${fmt.channels}, want mono` };
  if (dataStart < 0) return { ok: false, reason: "EMPTY_DATA", detail: "no data chunk" };
  const available = buffer.length - dataStart;
  // header-declared duration: honor the declared data size even if bytes are truncated
  const dataLength = dataDeclared;
  if (dataLength === 0)
    return {
      ok: false,
      reason: "EMPTY_DATA",
      detail: "zero-byte data chunk",
    };

  const blockAlign = fmt.channels * (fmt.bitsPerSample / 8);
  if (fmt.blockAlign !== null && fmt.blockAlign !== blockAlign)
    return {
      ok: false,
      reason: "LENGTH_MISMATCH",
      detail: `fmt block alignment ${fmt.blockAlign}, want ${blockAlign}`,
    };
  const nFrames = Math.floor(dataLength / blockAlign);
  if (nFrames === 0)
    return {
      ok: false,
      reason: "EMPTY_DATA",
      detail: "data chunk shorter than one frame",
    };
  const durationMs = (nFrames / fmt.sampleRate) * 1000;
  const data = buffer.subarray(
    dataStart,
    dataStart + Math.min(dataLength, blockAlign * 4800), // silence probe needs a mid window only
  );
  if (midWindowRmsJack(data, fmt.bitsPerSample) === null)
    return { ok: false, reason: "EMPTY_DATA", detail: "no readable samples" };
  const rms = midWindowRmsJack(data, fmt.bitsPerSample);
  if (rms === null || rms <= SILENCE_EPSILON)
    return {
      ok: false,
      reason: "SILENT",
      detail: `mid-window rms ${rms} below ${SILENCE_EPSILON}`,
    };

  return {
    ok: true,
    pcm: {
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      bitsPerSample: fmt.bitsPerSample,
      dataLength,
      dataOffset: dataStart,
      nFrames,
      durationMs,
    },
  };
}

const FAIL = (reason, detail) => ({ ok: false, reason, detail });

export function validateAudioBuffer(
  buffer,
  {
    maxBytes = DEFAULT_MAX_BYTES,
    minDurationMs = DEFAULT_MIN_DURATION_MS,
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    allowedSampleRates = DEFAULT_SAMPLE_RATES,
    allowedChannels = [1],
    allowedBits = [16],
  } = {},
) {
  // total size cap first
  if (buffer.length > maxBytes)
    return FAIL("TOO_LARGE", `buffer is ${buffer.length} bytes, cap is ${maxBytes}`);

  const parsed = parseWav(buffer);
  if (!parsed.ok) return parsed;
  const { sampleRate, channels, bitsPerSample, dataLength, dataOffset, nFrames, durationMs } =
    parsed.pcm;

  if (!allowedSampleRates.includes(sampleRate))
    return FAIL(
      "UNSUPPORTED_SAMPLE_RATE",
      `sample rate ${sampleRate}, allowed ${allowedSampleRates.join(",")}`,
    );
  if (!allowedChannels.includes(channels))
    return FAIL("NOT_MONO", `channels ${channels}, allowed ${allowedChannels.join(",")}`);
  if (!allowedBits.includes(bitsPerSample))
    return FAIL("NOT_S16", `bits per sample ${bitsPerSample}, allowed ${allowedBits.join(",")}`);
  if (durationMs < minDurationMs)
    return FAIL(
      "TOO_SHORT",
      `header duration ${Math.round(durationMs)} ms, min ${minDurationMs} ms`,
    );
  if (durationMs > maxDurationMs)
    return FAIL(
      "TOO_LONG",
      `header duration ${Math.round(durationMs)} ms, max ${maxDurationMs} ms`,
    );

  // data length consistent with frames, +/-1 byte per header padding tolerance
  const expected = nFrames * channels * (bitsPerSample / 8);
  if (Math.abs(dataLength - expected) > 1)
    return FAIL(
      "LENGTH_MISMATCH",
      `data length ${dataLength}, expected ${expected} for ${nFrames} frames`,
    );

  // at least one non-silent sample: rms over a mid window of available bytes
  const pcmView = buffer.subarray(
    dataOffset,
    dataOffset + Math.min(dataLength, buffer.length - dataOffset),
  );
  const rms = midWindowRmsJack(pcmView, bitsPerSample);
  if (rms === null || rms <= SILENCE_EPSILON)
    return FAIL("SILENT", `mid-window rms ${rms ?? "n/a"} below ${SILENCE_EPSILON}`);

  return { ok: true, parsed };
}
