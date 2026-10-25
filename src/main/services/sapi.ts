import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Windows 本地离线语音（SAPI / System.Speech）。
 *
 * 不依赖任何 API Key 或网络，用 PowerShell 调 .NET 的 System.Speech：
 * - TTS：SpeechSynthesizer 合成 WAV
 * - STT：SpeechRecognitionEngine + DictationGrammar 识别 WAV
 *
 * 文本/结果一律走 base64 或 UTF-8 文件，避免 PowerShell 参数注入与编码问题。
 */

const B64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64');

function powershell(): string {
  const root = process.env['SystemRoot'] || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function run(script: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve();
      },
    );
  });
}

function tmp(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

/** Windows 本地离线 TTS，返回 WAV 音频 */
export async function sapiSpeak(text: string, voice: string): Promise<{ buffer: Buffer; mime: string }> {
  const wav = tmp('sapi-tts', 'wav');
  const script = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.Speech`,
    `$s=New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${B64(voice || '')}'))`,
    `if($v -ne ''){try{$s.SelectVoice($v)}catch{}}`,
    `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${B64(text)}'))`,
    `$s.SetOutputToWaveFile('${wav.replace(/\\/g, '/')}')`,
    `$s.Speak($t)`,
    `$s.Dispose()`,
  ].join(';');
  try {
    await run(script);
    const buffer = fs.readFileSync(wav);
    if (buffer.byteLength === 0) throw new Error('SAPI 合成返回空音频');
    return { buffer, mime: 'audio/wav' };
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

/** language 提示词映射到 SAPI 识别文化；无匹配时留空用系统默认 */
function cultureOf(language: string | undefined): string {
  const l = (language || '').toLowerCase();
  if (l.startsWith('zh')) return 'zh-CN';
  if (l.startsWith('en')) return 'en-US';
  if (l.startsWith('ja')) return 'ja-JP';
  return '';
}

/** Windows 本地离线 STT，识别 WAV 返回文本 */
export async function sapiTranscribe(wavBuffer: Buffer, language?: string): Promise<string> {
  const wav = tmp('sapi-stt', 'wav');
  const out = tmp('sapi-stt', 'txt');
  fs.writeFileSync(wav, wavBuffer);

  const culture = cultureOf(language);
  const script = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.Speech`,
    `$r=$null`,
    `try{$r=New-Object System.Speech.Recognition.SpeechRecognitionEngine('${culture}')}catch{}`,
    `if(-not $r){$r=New-Object System.Speech.Recognition.SpeechRecognitionEngine}`,
    `$r.SetInputToWaveFile('${wav.replace(/\\/g, '/')}')`,
    `$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))`,
    `$res=$r.Recognize()`,
    `if($res){$txt=$res.Text}else{$txt=''}`,
    `[IO.File]::WriteAllText('${out.replace(/\\/g, '/')}', $txt, [Text.Encoding]::UTF8)`,
    `$r.Dispose()`,
  ].join(';');

  try {
    await run(script);
    return fs.readFileSync(out, 'utf-8').trim();
  } finally {
    fs.rmSync(wav, { force: true });
    fs.rmSync(out, { force: true });
  }
}
