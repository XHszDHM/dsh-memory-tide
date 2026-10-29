/**
 * server.js — 给设置页用的宿主端接口。
 *
 * 设置页在浏览器里跑，碰不到文件系统，所以这里开一个 POST 端点，
 * 让它能列出「用过潮汐记忆的工作空间」、读一份配置、写一份配置。
 *
 * 只依赖两样宿主公开的东西：
 *  - `ctx.connection.fetch.register()` 注册一条 HTTP 路由
 *  - `ctx.get('workingDirectory')?.defaultDirectory` 拿默认工作空间
 * 两样缺任何一样，就安静地不注册（插件本体照样能用）。
 *
 * 路由：POST /api/dsh-memory-tide
 * 协议与宿主自己的 client-request / server-response 同形。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULTS, mergeConfig, saveConfig } from './config.js';
import { memoryPaths } from './paths.js';

export const ROUTE = '/api/dsh-memory-tide';
export const ENDPOINT = 'dsh-memory-tide';

/** 跨平台取 DSH 家目录：环境变量优先，否则 ~/.dsh */
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return path.join(os.homedir(), '.dsh');
}

function dataDirectory() {
  return path.join(dshHome(), 'integrations', 'dsh-memory-tide');
}

function registryFile() {
  return path.join(dataDirectory(), 'workspaces.json');
}

/** 路径规范化：解析成绝对路径、去掉尾部分隔符，用于去重 */
function canonical(target) {
  const resolved = path.resolve(target);
  return resolved.length > 3 && /[\\/]$/.test(resolved) ? resolved.slice(0, -1) : resolved;
}

function samePath(a, b) {
  return canonical(a).toLowerCase() === canonical(b).toLowerCase();
}

async function readRegistry() {
  try {
    const text = await fs.readFile(registryFile(), 'utf8');
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (parsed === null || typeof parsed !== 'object') return { version: 1, roots: [] };
    const roots = Array.isArray(parsed.roots)
      ? parsed.roots
        .filter((item) => item !== null && typeof item === 'object' && typeof item.root === 'string')
        .map((item) => ({ root: canonical(item.root), at: typeof item.at === 'string' ? item.at : '' }))
      : [];
    return { version: 1, roots };
  } catch {
    return { version: 1, roots: [] };
  }
}

async function writeRegistry(registry) {
  await fs.mkdir(dataDirectory(), { recursive: true });
  await fs.writeFile(registryFile(), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

/** 记下「这个工作空间用过潮汐记忆」。同一个路径只存一条，只刷新时间。 */
export async function rememberWorkspace(root) {
  if (typeof root !== 'string' || !root.trim()) return;
  const target = canonical(root);
  const registry = await readRegistry();
  const stamp = new Date().toISOString();
  const index = registry.roots.findIndex((item) => samePath(item.root, target));
  if (index === -1) registry.roots.unshift({ root: target, at: stamp });
  else registry.roots[index] = { root: registry.roots[index].root, at: stamp };
  registry.roots = registry.roots.slice(0, 60);
  await writeRegistry(registry);
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** 校验并规范化用户给的根目录：必须是已存在的目录 */
async function requireRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少工作空间路径');
  const target = canonical(value.trim());
  if (!path.isAbsolute(target)) throw new Error(`工作空间路径必须是绝对路径：${target}`);
  if (!(await isDirectory(target))) throw new Error(`这个目录不存在：${target}`);
  return target;
}

/**
 * DSH 自己记着「有哪些工作空间」——`$DSH_HOME/storages/workspace.json` 的
 * `tables.workspaces[<id>]` 里每项带 `path` / `title` / `updatedAt`。
 * 设置页一打开就把它读一遍，用户不用手输路径。
 *
 * 这是宿主的内部存储格式，不保证永远不变：解析不出来就返回空数组，
 * 上层会退回我们自己的 workspaces.json，功能不受影响。
 */
async function discoverWorkspaces() {
  const file = path.join(dshHome(), 'storages', 'workspace.json');
  let parsed;
  try {
    parsed = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const table = parsed?.tables?.workspaces;
  if (table === null || typeof table !== 'object') return [];
  const found = [];
  for (const value of Object.values(table)) {
    if (value === null || typeof value !== 'object') continue;
    const target = typeof value.path === 'string' ? value.path.trim() : '';
    if (!target || !path.isAbsolute(target)) continue;
    found.push({
      root: canonical(target),
      title: typeof value.title === 'string' ? value.title.trim() : '',
      at: typeof value.updatedAt === 'string' ? value.updatedAt : ''
    });
  }
  // 最近动过的排前面
  found.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return found;
}

async function workspaceList(defaultRoot) {
  const [registry, discovered] = await Promise.all([readRegistry(), discoverWorkspaces()]);
  const roots = [];
  const seen = new Set();
  const push = async (root, { at = '', isDefault = false, source = 'manual', title = '' } = {}) => {
    const key = canonical(root).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const paths = memoryPaths(canonical(root));
    if (!(await isDirectory(paths.root))) return;
    roots.push({
      root: paths.root,
      title,
      source,
      lastUsed: at,
      isDefault,
      hasMemory: await isDirectory(paths.memoryDir),
      hasConfig: await pathExists(paths.configFile)
    });
  };
  if (typeof defaultRoot === 'string' && defaultRoot.trim()) {
    await push(defaultRoot, { isDefault: true, source: 'default' });
  }
  for (const item of discovered) {
    await push(item.root, { at: item.at, source: 'dsh', title: item.title });
  }
  for (const item of registry.roots) {
    await push(item.root, { at: item.at, source: 'manual' });
  }
  // 默认的永远排第一，其余保持「最近用过的在前」
  roots.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return { roots };
}

async function readConfigFor(root) {
  const paths = memoryPaths(root);
  let raw = null;
  try {
    raw = JSON.parse((await fs.readFile(paths.configFile, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    raw = null;
  }
  return {
    root: paths.root,
    config: mergeConfig(raw),
    defaults: { ...DEFAULTS },
    configFile: paths.configFile,
    exists: raw !== null,
    hasMemory: await isDirectory(paths.memoryDir)
  };
}

async function writeConfigFor(root, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('配置必须是一个对象');
  }
  const paths = memoryPaths(root);
  await fs.mkdir(paths.root, { recursive: true });
  const merged = await saveConfig(paths, patch);
  await rememberWorkspace(root);
  return { root: paths.root, config: merged, configFile: paths.configFile };
}

/**
 * 注册设置页用的端点。
 * @returns disposer（没注册成也返回一个空函数，调用方不用分支）
 */
export function registerSettingsRpc(ctx, { defaultRoot } = {}) {
  const connection = ctx.connection ?? ctx.get?.('connection');
  if (!connection?.fetch?.register) return () => {};

  const respond = (rpcId, result) => Response.json({ type: 'server-response', rpcId, result });

  const handle = async (method, payload) => {
    const input = payload !== null && typeof payload === 'object' ? payload : {};
    switch (method) {
      case 'workspace.list':
        return workspaceList(defaultRoot);
      case 'config.read':
        return readConfigFor(await requireRoot(input.root));
      case 'config.write':
        return writeConfigFor(await requireRoot(input.root), input.config);
      case 'config.reset': {
        const root = await requireRoot(input.root);
        const paths = memoryPaths(root);
        await fs.mkdir(paths.root, { recursive: true });
        const config = await saveConfig(paths, { ...DEFAULTS });
        return { root: paths.root, config, configFile: paths.configFile };
      }
      case 'workspace.forget': {
        const root = await requireRoot(input.root);
        const registry = await readRegistry();
        registry.roots = registry.roots.filter((item) => !samePath(item.root, root));
        await writeRegistry(registry);
        return { root };
      }
      default:
        throw new Error(`不认识的方法：${String(method)}`);
    }
  };

  let dispose;
  try {
    dispose = connection.fetch.register({
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
        if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 });
        }
        let message;
        try {
          message = await request.json();
        } catch {
          return new Response('body is not JSON', { status: 400 });
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request';
        if (message?.type !== 'client-request' || message?.method !== ENDPOINT) {
          return respond(rpcId, {
            ok: false,
            error: { code: 'memory-tide/bad-request', message: '请求格式不对', details: {} }
          });
        }
        const call = message.payload !== null && typeof message.payload === 'object' ? message.payload : {};
        try {
          const value = await handle(call.method, call.payload);
          return respond(rpcId, { ok: true, value });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          ctx.logger?.warn?.(`memory-tide settings: ${text}`);
          return respond(rpcId, {
            ok: false,
            error: { code: 'memory-tide/failed', message: text, details: {} }
          });
        }
      }
    });
  } catch (error) {
    ctx.logger?.warn?.(`memory-tide settings: 端点注册失败：${error instanceof Error ? error.message : String(error)}`);
    return () => {};
  }

  return () => {
    try {
      dispose?.();
    } catch {
      /* 忽略 */
    }
  };
}
