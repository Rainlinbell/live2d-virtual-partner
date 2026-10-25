/**
 * 本地 STT 用的 WAV 录音。
 *
 * MediaRecorder 只能产出 webm/opus，而 Windows SAPI 识别需要 PCM WAV，
 * 所以这里用 Web Audio 采集 PCM，重采样到 16kHz 单声道，编码为 16-bit WAV。
 */

const TARGET_RATE = 16000;

export interface WavRecorder {
  /** 结束录音，返回 WAV ArrayBuffer */
  stop(): Promise<ArrayBuffer>;
  /** 取消录音，释放麦克风 */
  cancel(): void;
}

function concat(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** 线性插值重采样 */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** 16-bit PCM 单声道 WAV 编码 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export async function startWavRecording(): Promise<WavRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const sourceRate = ctx.sampleRate;

  proc.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(proc);
  proc.connect(ctx.destination);

  let done = false;
  const cleanup = (): void => {
    try {
      proc.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    stop: () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        if (done) {
          reject(new Error('录音已停止'));
          return;
        }
        done = true;
        const samples = concat(chunks);
        cleanup();
        const resampled = resampleLinear(samples, sourceRate, TARGET_RATE);
        resolve(encodeWav(resampled, TARGET_RATE));
      }),
    cancel: () => {
      if (done) return;
      done = true;
      cleanup();
    },
  };
}
