import { app, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { CoreStatus, ModelInfo } from '../../shared/types';
import { configStore } from './configStore';

/** 旧版本写死的模型库路径，仅用于首次迁移 */
const LEGACY_MODELS_DIR = 'D:\\Developer\\AImodels\\live2d-models';

/** 当前模型库根目录（配置可改，默认在 userData/models） */
export function modelsDir(): string {
  const configured = configStore.get().modelsDir;
  if (configured && configured.trim()) return configured.trim();
  return path.join(app.getPath('userData'), 'models');
}

export function coreDir(): string {
  return app.getPath('userData');
}

export function ensureModelsDir(): string {
  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cubism Core 文件名 */
const CORE_FILES: Record<2 | 4, string> = {
  4: 'live2dcubismcore.min.js',
  2: 'live2d.min.js',
};

/**
 * 找模型入口。
 * 旧实现用 `stack.pop()` 的深度优先 + readdir 原始顺序，一个包里有多套模型时
 * 拿到哪一个是不确定的；这里改为：按「Cubism4 > Cubism2」优先级、
 * 路径更浅的优先、同深度按字典序，保证结果稳定。
 */
interface ModelEntry {
  entryFile: string;
  cubism: 2 | 4;
}

function findEntry(dir: string): ModelEntry | null {
  const queue: string[] = [dir];
  const candidates: Array<{ rel: string; depth: number; rank: number; entry: ModelEntry }> = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    let names: string[];
    try {
      names = fs.readdirSync(cur).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === '__MACOSX' || name.startsWith('.')) continue;
      const abs = path.join(cur, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        queue.push(abs);
        continue;
      }
      const lower = name.toLowerCase();
      const rel = path.relative(dir, abs);
      const depth = rel.split(/[\\/]/).length;
      if (lower.endsWith('.model3.json')) {
        candidates.push({ rel, depth, rank: 0, entry: { entryFile: rel, cubism: 4 } });
      } else if (lower.endsWith('.model.json')) {
        candidates.push({ rel, depth, rank: 1, entry: { entryFile: rel, cubism: 2 } });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.rel.localeCompare(b.rel);
  });
  return candidates[0].entry;
}

/** 找一个能当缩略图的 png/jpg（优先与模型同名的贴图） */
function findThumbnail(dir: string, entryFile: string): string | null {
  const entryBase = path.basename(entryFile).replace(/\.model3?\.json$/i, '');
  const entryDir = path.dirname(path.join(dir, entryFile));
  const searchDirs = [entryDir, dir];
  const names = ['thumbnail.png', 'preview.png', 'avatar.png', 'icon.png'];
  for (const d of searchDirs) {
    let files: string[];
    try {
      files = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const candidate of names) {
      const hit = files.find((f) => f.toLowerCase() === candidate);
      if (hit) return path.join(d, hit);
    }
    const matched = files.find(
      (f) => f.toLowerCase() === `${entryBase.toLowerCase()}.png` || f.toLowerCase() === `${entryBase.toLowerCase()}.jpg`,
    );
    if (matched) return path.join(d, matched);
  }
  return null;
}

function toModelInfo(dir: string): ModelInfo | null {
  const found = findEntry(dir);
  if (!found) return null;
  return {
    name: path.basename(dir),
    entryFile: found.entryFile,
    cubism: found.cubism,
    hasThumbnail: findThumbnail(dir, found.entryFile) !== null,
  };
}

export function listModels(): ModelInfo[] {
  const root = ensureModelsDir();
  const out: ModelInfo[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch {
    return out;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const info = toModelInfo(dir);
      if (info) out.push(info);
    } catch {
      continue;
    }
  }
  return out;
}

/** 重名时生成 `名字-2`、`名字-3`，不覆盖已有模型 */
function uniqueTarget(root: string, baseName: string): string {
  const safe = baseName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'model';
  let target = path.join(root, safe);
  let i = 2;
  while (fs.existsSync(target)) {
    target = path.join(root, `${safe}-${i}`);
    i += 1;
  }
  return target;
}

/**
 * 解压前校验每个条目的落点，挡住 zip-slip（`../` 或绝对路径把文件写到模型库外面）。
 */
function assertZipSafe(zip: AdmZip, target: string): void {
  const root = path.resolve(target);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`压缩包包含绝对路径条目：${entry.entryName}`);
    }
    const abs = path.resolve(root, name);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`压缩包包含越界路径：${entry.entryName}`);
    }
  }
}

/** 导入 zip 模型包 */
export async function importModelZip(parent: BrowserWindow): Promise<ModelInfo | null> {
  const ret = await dialog.showOpenDialog(parent, {
    title: '选择 Live2D 模型压缩包 (.zip)',
    filters: [{ name: 'Zip', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (ret.canceled || !ret.filePaths[0]) return null;

  const zipPath = ret.filePaths[0];
  const root = ensureModelsDir();
  const baseName = path.basename(zipPath, '.zip');
  const target = uniqueTarget(root, baseName);

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
    assertZipSafe(zip, target);
  } catch (e) {
    throw new Error(`无法读取压缩包：${(e as Error).message}`);
  }

  fs.mkdirSync(target, { recursive: true });
  try {
    zip.extractAllTo(target, true);
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error(`解压失败：${(e as Error).message}`);
  }

  // 外层多套了一层同名目录 → 把内容上提一级
  let info = toModelInfo(target);
  if (!info) {
    const children = fs.readdirSync(target).filter((n) => !n.startsWith('.') && n !== '__MACOSX');
    if (children.length === 1) {
      const sub = path.join(target, children[0]);
      if (fs.statSync(sub).isDirectory()) {
        info = toModelInfo(sub);
        if (info) {
          const tmp = `${target}.tmp`;
          fs.renameSync(sub, tmp);
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(tmp, target);
          info = toModelInfo(target);
        }
      }
    }
  }

  if (!info) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error(
      '压缩包里没找到 .model3.json / .model.json；如果模型文件名含日文或中文，请改用「导入文件夹」',
    );
  }
  return info;
}

/** 导入已解压的模型文件夹 */
export async function importModelFolder(parent: BrowserWindow): Promise<ModelInfo | null> {
  const ret = await dialog.showOpenDialog(parent, {
    title: '选择模型文件夹（包含 .model3.json 或 .model.json）',
    properties: ['openDirectory'],
  });
  if (ret.canceled || !ret.filePaths[0]) return null;

  const src = ret.filePaths[0];
  const root = ensureModelsDir();
  const target = uniqueTarget(root, path.basename(src));

  fs.cpSync(src, target, {
    recursive: true,
    filter: (from) => !path.basename(from).startsWith('.'),
  });

  const info = toModelInfo(target);
  if (!info) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error('该文件夹里没找到 .model3.json / .model.json');
  }
  return info;
}

export function deleteModel(name: string): void {
  const root = modelsDir();
  const dir = path.resolve(root, name);
  if (dir === path.resolve(root) || !dir.startsWith(path.resolve(root) + path.sep)) {
    throw new Error('非法模型名');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 缩略图绝对路径（没有则 null） */
export function thumbnailPath(name: string): string | null {
  const dir = path.resolve(modelsDir(), name);
  if (!dir.startsWith(path.resolve(modelsDir()) + path.sep)) return null;
  const found = findEntry(dir);
  if (!found) return null;
  return findThumbnail(dir, found.entryFile);
}

export function getCoreStatus(): CoreStatus {
  const dir = coreDir();
  return {
    cubism4: fs.existsSync(path.join(dir, CORE_FILES[4])),
    cubism2: fs.existsSync(path.join(dir, CORE_FILES[2])),
    modelsDir: modelsDir(),
    coreDir: dir,
  };
}

/** 让用户选一个 Cubism Core 文件，复制到 userData 并改名成约定的名字 */
export async function installCoreFile(parent: BrowserWindow, cubism: 2 | 4): Promise<boolean> {
  const ret = await dialog.showOpenDialog(parent, {
    title: `选择 Cubism ${cubism === 4 ? '4' : '2'} Core（${CORE_FILES[cubism]}）`,
    filters: [{ name: 'JavaScript', extensions: ['js'] }],
    properties: ['openFile'],
  });
  if (ret.canceled || !ret.filePaths[0]) return false;
  const src = ret.filePaths[0];
  const dest = path.join(coreDir(), CORE_FILES[cubism]);
  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    throw new Error(`安装 Core 失败：${(e as Error).message}`);
  }
}

/** 选择模型库目录，返回新目录 */
export async function chooseModelsDir(parent: BrowserWindow): Promise<string | null> {
  const ret = await dialog.showOpenDialog(parent, {
    title: '选择模型库目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: modelsDir(),
  });
  if (ret.canceled || !ret.filePaths[0]) return null;
  const dir = ret.filePaths[0];
  configStore.set({ modelsDir: dir });
  ensureModelsDir();
  return dir;
}

/** 把旧版本写死的目录迁移到 userData（仅在旧目录存在且当前为空时） */
export function migrateLegacyModelsDir(): void {
  try {
    if (!fs.existsSync(LEGACY_MODELS_DIR)) return;
    const current = modelsDir();
    if (path.resolve(current) === path.resolve(LEGACY_MODELS_DIR)) return;
    fs.mkdirSync(current, { recursive: true });
    if (fs.readdirSync(current).length > 0) return;
    for (const name of fs.readdirSync(LEGACY_MODELS_DIR)) {
      const from = path.join(LEGACY_MODELS_DIR, name);
      const to = path.join(current, name);
      if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
    }
  } catch (e) {
    console.warn('[models] 迁移旧模型库失败:', (e as Error).message);
  }
}
