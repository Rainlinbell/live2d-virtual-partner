/**
 * 摄像头交互控制器：本地采集 + 镜像 + 人脸位置 / 动作识别。
 *
 * 隐私设计：视频帧只在本地 canvas 上逐帧处理，绝不发送到网络。
 * 人脸位置用肤色（YCbCr）分割 + 运动检测近似估计，无需任何模型文件，
 * 因此完全离线、零依赖、且不受打包 CSP（禁 unsafe-eval）影响。
 */

export interface TrackUpdate {
  /** 归一化水平位置 [-1,1]，右为正（与镜像预览一致） */
  x: number;
  /** 归一化垂直位置 [-1,1]，下为正 */
  y: number;
  /** 当前是否检测到人脸（肤色区域） */
  face: boolean;
}

export type CameraEvent = 'hello' | 'wave' | 'near' | 'far';

export interface CameraControllerOptions {
  /** 预览/采集共用的视频元素 */
  video: HTMLVideoElement;
  /** 离屏处理画布（隐藏即可） */
  canvas: HTMLCanvasElement;
  mirror: boolean;
  onTrack?: (t: TrackUpdate) => void;
  onEvent?: (e: CameraEvent) => void;
}

/** 经典 YCbCr 肤色判定 */
function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 60 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

const W = 160;
const H = 120;

export class CameraController {
  private stream: MediaStream | null = null;
  private ctx: CanvasRenderingContext2D | null;
  private lastGray: Uint8Array | null = null;
  private raf = 0;
  private lastTick = 0;
  private running = false;

  private faceActive = false;
  private absentTicks = 0;
  private areaSmooth = 0;
  private lastArea = 0;
  private motionX: number[] = [];
  private motionActive: number[] = [];
  private cooldowns = new Map<string, number>();

  constructor(private opts: CameraControllerOptions) {
    this.ctx = opts.canvas.getContext('2d', { willReadFrequently: true });
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    this.opts.video.srcObject = this.stream;
    await this.opts.video.play().catch(() => undefined);
    this.running = true;
    this.lastTick = 0;
    this.raf = requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.opts.video.srcObject = null;
    this.lastGray = null;
    this.faceActive = false;
    this.absentTicks = 0;
    this.areaSmooth = 0;
    this.lastArea = 0;
    this.motionX = [];
    this.motionActive = [];
  }

  setMirror(mirror: boolean): void {
    this.opts.mirror = mirror;
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (now - this.lastTick < 80) return; // 约 12.5 Hz，足够跟踪又不吃 CPU
    this.lastTick = now;
    this.process();
  };

  private process(): void {
    const ctx = this.ctx;
    const vw = this.opts.video.videoWidth;
    const vh = this.opts.video.videoHeight;
    if (!ctx || !vw || !vh) return;

    this.opts.canvas.width = W;
    this.opts.canvas.height = H;
    ctx.save();
    if (this.opts.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.opts.video, 0, 0, W, H);
    ctx.restore();

    const data = ctx.getImageData(0, 0, W, H).data;
    const gray = this.lastGray ?? new Uint8Array(W * H);

    let sx = 0;
    let sy = 0;
    let sn = 0;
    let mx = 0;
    let my = 0;
    let mn = 0;

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gy = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        const idx = y * W + x;

        if (isSkin(r, g, b)) {
          sx += x;
          sy += y;
          sn += 1;
        }

        const prev = this.lastGray ? this.lastGray[idx] : gy;
        if (Math.abs(gy - prev) > 28) {
          mx += x;
          my += y;
          mn += 1;
        }
        gray[idx] = gy;
      }
    }
    this.lastGray = gray;

    // 肤色占比：过小视为无人，过大（贴镜头/整屏）视为异常
    const skinRatio = sn / (W * H);
    const faceFound = skinRatio > 0.01 && skinRatio < 0.6;

    let x = 0;
    let y = 0;
    if (faceFound) {
      x = (sx / sn / W) * 2 - 1;
      y = (sy / sn / H) * 2 - 1;
      this.areaSmooth = this.areaSmooth ? this.areaSmooth * 0.7 + sn * 0.3 : sn;
    } else {
      this.areaSmooth = this.areaSmooth * 0.92;
      if (mn > W * H * 0.005) {
        // 无肤色时用运动质心兜底
        x = (mx / mn / W) * 2 - 1;
        y = (my / mn / H) * 2 - 1;
      }
    }

    this.opts.onTrack?.({ x, y, face: faceFound });
    this.detectEvents(faceFound, sn, mx / Math.max(1, mn), mn);
  }

  private detectEvents(faceFound: boolean, sn: number, motionCx: number, mn: number): void {
    const now = performance.now();

    if (faceFound) {
      if (!this.faceActive) {
        if (this.absentTicks > 5) this.fire('hello', now);
        this.lastArea = sn;
      }
      this.faceActive = true;
      this.absentTicks = 0;
      // 靠近：肤色面积显著增大
      if (sn > 120 && this.areaSmooth > 300 && sn > this.areaSmooth * 1.7) this.fire('near', now);
      // 远离：相对上一帧大幅缩小
      if (this.lastArea > 300 && sn < this.lastArea * 0.5) this.fire('far', now);
      this.lastArea = sn;
    } else {
      this.absentTicks += 1;
      if (this.absentTicks > 40) this.faceActive = false;
      this.lastArea = 0;
    }

    // 挥手：上半区域水平往复 + 持续较高运动量
    this.motionX.push(motionCx);
    this.motionActive.push(mn);
    if (this.motionX.length > 16) this.motionX.shift();
    if (this.motionActive.length > 16) this.motionActive.shift();

    if (this.motionX.length >= 12) {
      let flips = 0;
      for (let i = 1; i < this.motionX.length; i += 1) {
        const a = this.motionX[i - 1] - W / 2;
        const b = this.motionX[i] - W / 2;
        if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) flips += 1;
      }
      const active = this.motionActive.filter((v) => v > W * H * 0.002).length;
      if (flips >= 4 && active >= 8) this.fire('wave', now);
    }
  }

  private fire(e: CameraEvent, now: number): void {
    const last = this.cooldowns.get(e) ?? 0;
    if (now - last < cooldownMs(e)) return;
    this.cooldowns.set(e, now);
    this.opts.onEvent?.(e);
  }
}

function cooldownMs(e: CameraEvent): number {
  switch (e) {
    case 'hello':
      return 15000;
    case 'wave':
      return 20000;
    case 'near':
      return 12000;
    case 'far':
      return 15000;
    default:
      return 10000;
  }
}
