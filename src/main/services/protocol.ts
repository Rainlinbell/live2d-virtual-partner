import { app, net, protocol } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { modelsDir, thumbnailPath } from './modelManager';

/**
 * live2d:// 自定义协议，避免开 webSecurity:false：
 *   live2d://models/<name>/<file...>   →  <模型库>/<name>/<file...>
 *   live2d://core/<file>               →  userData/<file>（Cubism Core 由用户自行放入）
 *   live2d://thumbnail/<name>          →  该模型的预览图
 */

/** 必须在 app ready 之前调用 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'live2d',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // 渲染层用 fetch/XHR 读 model3.json 与贴图，自定义协议必须显式允许 CORS，
        // 否则在 file:// 页面里会得到 "Failed to fetch"
        corsEnabled: true,
        stream: true,
        // 保留 bypassCSP 以免严格 CSP 把模型资源一并挡掉
        bypassCSP: true,
      },
    },
  ]);
}

/** 把 URL 路径解析成绝对路径，越界返回 null（防目录穿越） */
function resolveSafe(base: string, rel: string): string | null {
  if (!rel) return null;
  const root = path.resolve(base);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 必须在 app ready 之后调用 */
export function installProtocolHandler(): void {
  protocol.handle('live2d', (req) => {
    try {
      const url = new URL(req.url);
      const host = url.host;
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');

      let abs: string | null = null;
      if (host === 'models') {
        abs = resolveSafe(modelsDir(), rel);
      } else if (host === 'core') {
        abs = resolveSafe(app.getPath('userData'), rel);
      } else if (host === 'thumbnail') {
        abs = thumbnailPath(rel.split('/')[0]);
      } else if (host === 'avatar') {
        abs = resolveSafe(path.join(app.getPath('userData'), 'avatars'), rel);
      }

      if (!abs) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch (e) {
      console.error('[protocol] 处理失败:', e);
      return new Response('Not Found', { status: 404 });
    }
  });
}
