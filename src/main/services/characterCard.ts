import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { app, dialog, BrowserWindow } from 'electron';
import type { Character } from '../../shared/types';
import { defaultCharacter } from '../../shared/types';

/* ------------------------------------------------------------------ */
/*  SillyTavern 角色卡数据结构（v1 / v2）                              */
/* ------------------------------------------------------------------ */

interface CharCardV1 {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  creator?: string;
  character_version?: string;
  alternate_greetings?: string[];
}

interface CharCardV2 {
  spec: 'chara_card_v2';
  spec_version: string;
  data: CharCardV1 & {
    alternate_greetings?: string[];
    character_book?: unknown;
  };
}

type AnyCard = CharCardV1 | CharCardV2;

function isV2(card: AnyCard): card is CharCardV2 {
  return (card as CharCardV2).spec === 'chara_card_v2';
}

/** 取卡片的实际数据体（v2 在 data 字段，v1 平铺） */
function cardData(card: AnyCard): CharCardV1 {
  return isV2(card) ? card.data : card;
}

/* ------------------------------------------------------------------ */
/*  PNG 解析：提取 chara tEXt / iTXt 块                                 */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 从 PNG 缓冲区中读取所有文本块（tEXt / iTXt），返回 keyword -> text 映射。
 * SillyTavern 将角色卡 JSON（base64）存放在 keyword 为 "chara" 的块中。
 */
function extractPngTextChunks(buf: Buffer): Map<string, string> {
  const result = new Map<string, string>();
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是有效的 PNG 文件');
  }

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break;

    if (type === 'tEXt') {
      // keyword\0text（均为 latin1）
      const data = buf.subarray(dataStart, dataEnd);
      const nullIdx = data.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = data.toString('latin1', 0, nullIdx);
        const text = data.toString('latin1', nullIdx + 1);
        result.set(keyword, text);
      }
    } else if (type === 'iTXt') {
      // keyword\0 compressionFlag(1) compressionMethod(1) languageTag\0 translatedKeyword\0 text
      const data = buf.subarray(dataStart, dataEnd);
      let pos = 0;
      const null1 = data.indexOf(0, pos);
      if (null1 < 0) {
        offset = dataEnd + 4;
        continue;
      }
      const keyword = data.toString('latin1', pos, null1);
      pos = null1 + 1;
      if (pos + 2 > data.length) {
        offset = dataEnd + 4;
        continue;
      }
      const compressionFlag = data[pos];
      pos += 2; // flag + method
      const null2 = data.indexOf(0, pos);
      if (null2 < 0) {
        offset = dataEnd + 4;
        continue;
      }
      pos = null2 + 1; // skip language tag
      const null3 = data.indexOf(0, pos);
      if (null3 < 0) {
        offset = dataEnd + 4;
        continue;
      }
      pos = null3 + 1; // skip translated keyword
      let textBytes = data.subarray(pos);
      if (compressionFlag === 1) {
        try {
          textBytes = zlib.inflateSync(textBytes);
        } catch {
          offset = dataEnd + 4;
          continue;
        }
      }
      result.set(keyword, textBytes.toString('utf8'));
    }

    offset = dataEnd + 4; // skip CRC
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  文件解析入口                                                        */
/* ------------------------------------------------------------------ */

/** 从文件路径解析角色卡（支持 .json 和 .png） */
export function parseCharacterCard(filePath: string): AnyCard {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  const buf = fs.readFileSync(filePath);

  if (ext === '.json') {
    return JSON.parse(buf.toString('utf8')) as AnyCard;
  }

  if (ext === '.png') {
    const chunks = extractPngTextChunks(buf);
    const chara = chunks.get('chara');
    if (!chara) throw new Error('PNG 中未找到 chara 块，不是有效的傻酒馆角色卡');
    // chara 块内容是 base64 编码的 JSON
    const jsonBuf = Buffer.from(chara, 'base64');
    return JSON.parse(jsonBuf.toString('utf8')) as AnyCard;
  }

  throw new Error('不支持的文件格式，仅支持 .json 和 .png');
}

/** 把角色卡字段映射到我们的 Character 结构 */
export function cardToCharacter(card: AnyCard): Omit<Character, 'id'> {
  const d = cardData(card);
  const base = defaultCharacter({});
  const name = (d.name || '导入角色').trim() || '导入角色';

  // 性格字段：优先 personality，其次 description
  const personality = [d.personality, d.description].filter(Boolean).join('\n').trim();

  // system prompt：若卡片自带 system_prompt 则直接用；
  // 否则把 description / scenario / mes_example / post_history_instructions 拼起来
  let systemPrompt: string;
  if (d.system_prompt && d.system_prompt.trim()) {
    systemPrompt = d.system_prompt.trim();
  } else {
    const parts: string[] = [];
    if (d.description) parts.push(`角色设定：\n${d.description}`);
    if (d.scenario) parts.push(`场景：\n${d.scenario}`);
    if (d.personality) parts.push(`性格：\n${d.personality}`);
    if (d.mes_example) parts.push(`对话示例：\n${d.mes_example}`);
    if (d.post_history_instructions) parts.push(d.post_history_instructions);
    systemPrompt = parts.join('\n\n').trim();
  }

  // 世界书（character_book）
  const rawBook = (d as { character_book?: unknown }).character_book;
  const bookEntries =
    rawBook && typeof rawBook === 'object' ? (rawBook as { entries?: unknown }).entries : undefined;
  const worldBook = Array.isArray(bookEntries)
    ? bookEntries
        .map((e) => {
          const r = (e ?? {}) as { keys?: unknown; key?: unknown; content?: unknown };
          const keys = Array.isArray(r.keys)
            ? r.keys.map(String)
            : typeof r.key === 'string'
              ? [r.key]
              : [];
          return { keys, content: typeof r.content === 'string' ? r.content : '' };
        })
        .filter((e) => e.content.trim())
    : [];

  return {
    ...base,
    name,
    personality: personality || base.personality,
    systemPrompt,
    // 角色卡的 first_mes 就是开场白，直接拿来当欢迎语
    greeting: (d.first_mes || '').trim() || base.greeting,
    worldBook,
    alternateGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.slice() : [],
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
  };
}

/** 把角色卡 PNG 复制到 userData/avatars，返回 live2d://avatar/<file> 供渲染层显示 */
function saveAvatarFromPng(filePath: string): string | null {
  try {
    const dir = path.join(app.getPath('userData'), 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    fs.copyFileSync(filePath, path.join(dir, name));
    return `live2d://avatar/${name}`;
  } catch (e) {
    console.warn('[card] 保存角色头像失败:', (e as Error).message);
    return null;
  }
}

/** 弹出文件选择框并导入角色卡，返回新创建的角色数据（不含 id，由调用方入库） */
export async function importCharacterCardDialog(
  parent: BrowserWindow,
): Promise<Omit<Character, 'id'> | null> {
  const ret = await dialog.showOpenDialog(parent, {
    title: '选择傻酒馆角色卡（.png / .json）',
    filters: [
      { name: '角色卡', extensions: ['png', 'json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (ret.canceled || !ret.filePaths[0]) return null;

  const filePath = ret.filePaths[0];
  const card = parseCharacterCard(filePath);
  const character = cardToCharacter(card);
  if (filePath.toLowerCase().endsWith('.png')) {
    const avatar = saveAvatarFromPng(filePath);
    if (avatar) character.avatar = avatar;
  }
  return character;
}

/* ------------------------------------------------------------------ */
/*  PNG 卡片写入：把角色卡 JSON（base64）塞进 PNG 的 chara tEXt 块       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** 在源 PNG 中插入/替换 chara tEXt 块，返回新 PNG（SillyTavern 兼容） */
function writeCharaChunk(png: Buffer, jsonText: string): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('头像不是有效的 PNG 文件');
  }
  const b64 = Buffer.from(jsonText, 'utf8').toString('base64');
  const charaData = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(b64, 'ascii')]);

  const chunks: Buffer[] = [];
  let offset = 8;
  let inserted = false;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) break;
    const data = png.subarray(dataStart, dataEnd);

    if (type === 'tEXt' || type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      const keyword = nullIdx >= 0 ? data.toString('latin1', 0, nullIdx) : '';
      if (keyword === 'chara') {
        offset = dataEnd + 4; // 跳过旧的 chara 块
        continue;
      }
    }
    if (!inserted && type === 'IDAT') {
      chunks.push(pngChunk('tEXt', charaData));
      inserted = true;
    }
    chunks.push(png.subarray(offset, dataEnd + 4));
    offset = dataEnd + 4;
  }
  if (!inserted) throw new Error('头像 PNG 结构异常，未找到 IDAT 块');
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/** 从角色头像 URL（live2d://avatar/<file>）解析出本地文件路径 */
function avatarFilePath(avatarUrl: string): string | null {
  const m = /^live2d:\/\/avatar\/([^/?#]+)$/.exec(avatarUrl.trim());
  if (!m) return null;
  const name = decodeURIComponent(m[1]);
  const dir = path.join(app.getPath('userData'), 'avatars');
  const p = path.resolve(dir, name);
  if (!p.startsWith(path.resolve(dir) + path.sep)) return null;
  return p;
}

/** 把角色导出为傻酒馆 v2 卡 JSON 字符串 */
export function characterToCardJson(character: Character): string {
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.personality,
      personality: character.personality,
      scenario: '',
      first_mes: character.greeting,
      mes_example: '',
      creator_notes: '由 Live2D 虚拟伴侣导出',
      system_prompt: character.systemPrompt,
      post_history_instructions: '',
      tags: character.tags ?? [],
      creator: 'Live2D Virtual Partner',
      character_version: '1.0',
      alternate_greetings: character.alternateGreetings ?? [],
      character_book: {
        entries: (character.worldBook ?? []).map((e) => ({
          keys: e.keys ?? [],
          content: e.content,
        })),
      },
      extensions: {
        live2d: {
          activeModel: character.activeModel,
          voice: character.voice,
          emotionMap: character.emotionMap,
          modelScale: character.modelScale,
          modelOffsetY: character.modelOffsetY,
        },
      },
    },
  };
  return JSON.stringify(card, null, 2);
}

/** 弹出保存框并导出角色卡（.json 或 .png） */
export async function exportCharacterCardDialog(
  parent: BrowserWindow,
  character: Character,
): Promise<boolean> {
  const ret = await dialog.showSaveDialog(parent, {
    title: '导出角色卡',
    defaultPath: `${character.name || 'character'}.json`,
    filters: [
      { name: '角色卡 JSON', extensions: ['json'] },
      { name: '角色卡 PNG（含立绘）', extensions: ['png'] },
    ],
  });
  if (ret.canceled || !ret.filePath) return false;

  const json = characterToCardJson(character);
  try {
    if (ret.filePath.toLowerCase().endsWith('.png')) {
      const src = avatarFilePath(character.avatar);
      if (!src || !fs.existsSync(src)) {
        throw new Error('当前角色没有头像 PNG，无法导出 PNG 卡，请改用 JSON 格式');
      }
      const png = writeCharaChunk(fs.readFileSync(src), json);
      fs.writeFileSync(ret.filePath, png);
    } else {
      fs.writeFileSync(ret.filePath, json, 'utf8');
    }
    return true;
  } catch (e) {
    throw new Error(`导出失败：${(e as Error).message}`);
  }
}

