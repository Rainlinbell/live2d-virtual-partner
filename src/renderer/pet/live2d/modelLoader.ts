import './stage'; // 确保 window.PIXI 先就绪
import type * as PIXI from 'pixi.js';
import type { Live2DModel as Cubism4Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';
import type { ModelInfo } from '../../../shared/types';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

/** 按需加载 Cubism Core（由用户放置于 userData 目录，经 live2d://core/ 提供） */
async function ensureCore(cubism: 2 | 3 | 4): Promise<void> {
  if (cubism !== 2 && !window.Live2DCubismCore) {
    await loadScript('live2d://core/live2dcubismcore.min.js');
  }
  if (cubism === 2 && !window.Live2D) {
    await loadScript('live2d://core/live2d.min.js');
  }
}

export type AnyLive2DModel = Cubism4Live2DModel;
type ModelClass = typeof Cubism4Live2DModel;

/**
 * 运行时再决定加载哪个 Cubism 运行时模块。
 * 包根入口会把 cubism2 插件一起注册，缺少 live2d.min.js 时整个模块在 import 阶段就抛错，
 * 所以这里先加载对应的 Core 脚本，再动态 import 对应的子入口。
 */
const modelClasses = new Map<2 | 4, Promise<ModelClass>>();

function resolveModelClass(cubism: 2 | 3 | 4): Promise<ModelClass> {
  const key: 2 | 4 = cubism === 2 ? 2 : 4;
  let pending = modelClasses.get(key);
  if (!pending) {
    pending = (async () => {
      await ensureCore(cubism);
      const mod =
        key === 2
          ? await import('pixi-live2d-display-lipsyncpatch/cubism2')
          : await import('pixi-live2d-display-lipsyncpatch/cubism4');
      return mod.Live2DModel as unknown as ModelClass;
    })();
    modelClasses.set(key, pending);
    pending.catch(() => modelClasses.delete(key));
  }
  return pending;
}

export interface FitOptions {
  /** 相对自适应尺寸的倍率 */
  scale?: number;
  /** 垂直偏移（像素） */
  offsetY?: number;
}

let current: AnyLive2DModel | null = null;
let currentApp: PIXI.Application | null = null;
let currentFit: FitOptions = {};
let resizeHandler: (() => void) | null = null;

/** 按比例缩放并居中；缩放/偏移改变时也走这里，不必重新加载模型 */
export function fitToWindow(app: PIXI.Application, model: AnyLive2DModel): void {
  const w = app.renderer.screen.width;
  const h = app.renderer.screen.height;
  const scaleFactor = currentFit.scale && currentFit.scale > 0 ? currentFit.scale : 1;

  // 模型的本地包围盒原点通常不是 0（Cubism 以画布中心为原点，坐标有负值），
  // 直接用 (容器宽 - 模型宽) / 2 定位会整体偏到右下角，所以要按 bounds 校准。
  model.scale.set(1);
  const bounds = model.getLocalBounds();
  const boxWidth = bounds.width || model.width || 1;
  const boxHeight = bounds.height || model.height || 1;

  const scale = Math.min(w / boxWidth, h / boxHeight) * 0.92 * scaleFactor;
  model.scale.set(scale);
  model.x = (w - boxWidth * scale) / 2 - bounds.x * scale;
  model.y = (h - boxHeight * scale) / 2 - bounds.y * scale + (currentFit.offsetY ?? 0);
}

export function setFitOptions(options: FitOptions): void {
  currentFit = { ...currentFit, ...options };
  if (currentApp && current) fitToWindow(currentApp, current);
}

/** 卸载当前模型并解绑 resize（旧实现每次加载都新增一个监听，切换模型后越积越多） */
export function disposeModel(): void {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  const model = current;
  current = null;
  currentApp = null;
  if (model) {
    try {
      model.destroy({ children: true });
    } catch {
      /* 已销毁 */
    }
  }
}

type RenderOrders = Int32Array | number[];

interface CoreModelLike {
  _model?: { renderOrders?: RenderOrders };
  getDrawableCount(): number;
  getDrawableRenderOrders?: () => RenderOrders | undefined;
  __renderOrdersPatched?: boolean;
}

/**
 * Cubism Core 5/6 把 drawable 的绘制顺序从 `drawables.renderOrders` 挪到了 `Model.renderOrders`，
 * 而本库内置的 Cubism Framework 4-r.1 仍然读旧字段 —— 字段缺失时 `doDrawModel()` 会抛
 * `TypeError: Cannot read properties of undefined (reading '0')`，表现为模型加载成功却一帧都画不出来。
 * 这里给 `getDrawableRenderOrders` 打补丁：优先取 Core 的新位置，再退化为索引顺序。
 */
function patchRenderOrders(model: AnyLive2DModel): void {
  const internal = (model as unknown as { internalModel?: { coreModel?: CoreModelLike } }).internalModel;
  const core = internal?.coreModel;
  if (!core) return;

  const proto = Object.getPrototypeOf(core) as CoreModelLike;
  if (!proto || proto.__renderOrdersPatched) return;
  proto.__renderOrdersPatched = true;

  const original = proto.getDrawableRenderOrders;
  proto.getDrawableRenderOrders = function patchedRenderOrders(this: CoreModelLike): RenderOrders {
    const orders = original?.call(this);
    if (orders && orders.length) return orders;

    const fromCore = this._model?.renderOrders;
    if (fromCore && fromCore.length) return fromCore;

    const count = this.getDrawableCount();
    const fallback = new Int32Array(count);
    for (let i = 0; i < count; i += 1) fallback[i] = i;
    return fallback;
  };
}

/**
 * 加载并挂载模型。旧模型会被安全卸载。
 */
export async function loadModel(
  app: PIXI.Application,
  info: ModelInfo,
  options: FitOptions = {},
): Promise<AnyLive2DModel> {
  const ModelClass = await resolveModelClass(info.cubism);

  const entry = info.entryFile.split('\\').join('/');
  const url = `live2d://models/${encodeURIComponent(info.name)}/${entry
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const model = (await ModelClass.from(url, { autoInteract: true })) as AnyLive2DModel;
  patchRenderOrders(model);

  // 先摘掉旧模型再挂新的，避免同一帧里两个模型抢参数
  const previous = current;
  currentFit = options;
  current = model;
  currentApp = app;

  app.stage.removeChildren().forEach((child) => {
    try {
      child.destroy({ children: true });
    } catch {
      /* ignore */
    }
  });
  if (previous && previous !== model) {
    try {
      previous.destroy({ children: true });
    } catch {
      /* ignore */
    }
  }

  app.stage.addChild(model);
  fitToWindow(app, model);

  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  resizeHandler = () => fitToWindow(app, model);
  window.addEventListener('resize', resizeHandler);

  return model;
}
