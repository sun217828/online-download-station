const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const stream = require('stream');
const multer = require('multer');
const { pinyin } = require('pinyin-pro');
const db = require('./db');

const app = express();

// ============ 配置区（可按需修改） ============
const PORT = process.env.PORT || 8080;
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, 'files');
const PRIVATE_FILES_DIR = process.env.PRIVATE_FILES_DIR || path.join(__dirname, 'files-private');
const PENDING_DIR = process.env.PENDING_DIR || path.join(__dirname, 'pending');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ANNOUNCEMENTS_FILE = process.env.ANNOUNCEMENTS_FILE || path.join(DATA_DIR, 'announcements.json');
const FEEDBACK_DIR = process.env.FEEDBACK_DIR || path.join(__dirname, 'feedback');
const HOST = process.env.HOST || '0.0.0.0';
const CHUNK_SIZE = 1024 * 1024; // 1MB
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // 审核密码，建议改复杂点
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''; // 联系管理员邮箱（设置页展示用）
// 用户配额：每人 1GB 私密文件空间
const USER_QUOTA_BYTES = parseInt(process.env.USER_QUOTA_BYTES || '10737418240', 10); // 10 GiB
// 会话有效期：30 天
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SESSION_COOKIE = 'sid';
// 危险字符正则：只过滤真正用于注入攻击的字符（< > " ' ` | & ; \ 及控制字符）
// 保留 () - _ * # @ ! ~ ^ $ {} [] 等正常描述用字符
const UNSAFE_CHAR_REGEX = /[<>"'`|&;\\\x00-\x1f]/g;
const MAX_DESC_LENGTH = 100;
const SUGGEST_MAX_SIZE = 2 * 1024 * 1024 * 1024; // 建议最大 2GB（只提醒，不强制）
// ==============================================
// ============ 分片上传配置 ============
const CHUNK_UPLOAD_DIR = process.env.CHUNK_UPLOAD_DIR || path.join(__dirname, 'chunks'); // 分片暂存目录
const DEFAULT_CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || (5 * 1024 * 1024).toString(), 10); // 默认 5MB
const CHUNK_MAX_SIZE = 10 * 1024 * 1024;       // 单片上限 10MB
const CHUNK_CONCURRENCY = 5;                     // 前端并发数（仅文档用，后端无限制）
const UPLOAD_SESSION_TTL_MS = 24 * 3600 * 1000;  // 上传会话保留 24 小时
const CHUNK_RETRIES = 3;                          // 前端重试次数（仅文档用）
// ==============================================

// 每用户私密文件目录：files-private/users/<username>/
const USER_PRIVATE_ROOT = path.join(PRIVATE_FILES_DIR, 'users');

// 确保目录存在
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  console.log(`[提示] 下载目录已创建：${FILES_DIR}`);
}
if (!fs.existsSync(PENDING_DIR)) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  console.log(`[提示] 待审核目录已创建：${PENDING_DIR}`);
}
if (!fs.existsSync(PRIVATE_FILES_DIR)) {
  fs.mkdirSync(PRIVATE_FILES_DIR, { recursive: true });
  console.log(`[提示] 私密文件目录已创建：${PRIVATE_FILES_DIR}`);
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[提示] 数据目录已创建：${DATA_DIR}`);
}
if (!fs.existsSync(FEEDBACK_DIR)) {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  console.log(`[提示] 反馈目录已创建：${FEEDBACK_DIR}`);
}
if (!fs.existsSync(USER_PRIVATE_ROOT)) {
  fs.mkdirSync(USER_PRIVATE_ROOT, { recursive: true });
}
if (!fs.existsSync(CHUNK_UPLOAD_DIR)) {
  fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
  console.log(`[提示] 分片暂存目录已创建：${CHUNK_UPLOAD_DIR}`);
}

// 启动时清理过期分片上传会话
function cleanupExpiredUploadSessions() {
  try {
    const expired = db.cleanExpiredUploads(UPLOAD_SESSION_TTL_MS);
    if (expired && expired.length) {
      for (const row of expired) {
        try {
          const sessDir = path.join(CHUNK_UPLOAD_DIR, row.upload_id);
          if (fs.existsSync(sessDir)) fs.rmSync(sessDir, { recursive: true, force: true });
          db.deleteUploadSession(row.upload_id);
          db.clearChunkCache(row.upload_id);
        } catch (e) {}
      }
      console.log(`[清理] 已清理 ${expired.length} 个过期上传会话`);
    }
  } catch (e) { console.error('[清理过期上传会话失败]', e.message); }
}
cleanupExpiredUploadSessions();
setInterval(cleanupExpiredUploadSessions, 3600 * 1000); // 每小时一次

// JSON body 中间件
app.use(express.json({ limit: '10mb' }));

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

// ============ Cookie 解析（轻量自实现，免装 cookie-parser） ============
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        req.cookies[k] = decodeURIComponent(v);
      }
    });
  }
  next();
});

// ============ 会话中间件：解析 httpOnly cookie，挂 req.user ============
// 启动时清理一次过期会话
db.cleanExpiredSessions();
// 每小时清理一次过期会话
setInterval(() => db.cleanExpiredSessions(), 3600 * 1000);

app.use((req, res, next) => {
  req.user = null;
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const row = db.getSessionRow(token);
    if (row && row.expires_at > Date.now()) {
      const u = db.getUserById(row.user_id);
      if (u) {
        req.user = {
          id: u.id,
          username: u.username,
          email: u.email,
          uploadLocked: !!u.upload_locked,
          isAdmin: !!u.is_admin
        };
        req.sessionToken = token;
      }
    } else if (row) {
      // 过期了，清掉
      db.deleteSession(token);
    }
  }
  next();
});

// 要求登录的中间件
function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '请先登录' });
  next();
}

// ============ 文件所有权鉴权中间件 ============
// 鉴权策略（覆盖下载/预览/删除/上传所有文件操作接口）：
//   1. public  文件：任何人可下载/预览
//   2. private 文件（管理员可见）：仅管理员
//   3. hidden  文件（隐藏启动 #[原名]）：仅管理员
//   4. user-private 文件：仅文件 owner 本人或管理员
//   5. 所有删除操作：仅 owner 或管理员
//
// 实现方式：通过 dirname 在三处目录定位 → 读 meta.json → 取 visibility/owner → 比对 req.user

function resolvePackageMeta(dirPath) {
  // 返回 { visibility, owner, meta, dirPath, bodyPath } 或 null
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
  const meta = readPackageMeta(dirPath);
  const bodyPath = getPackageBodyPath(dirPath);
  let visibility = meta.visibility || 'public';
  // 隐藏启动目录 #[xxx] 默认 private
  if (!meta.visibility && isHiddenPackageDir(path.basename(dirPath))) visibility = 'private';
  return { visibility, owner: meta.owner || null, meta, dirPath, bodyPath };
}

function locatePackageMeta(dirname) {
  // 公开 → 私密 → 隐藏启动，逐个尝试
  const tryPaths = [
    path.join(FILES_DIR, dirname),
    path.join(PRIVATE_FILES_DIR, dirname),
    path.join(PRIVATE_FILES_DIR, `#[${dirname}]`)
  ];
  for (const p of tryPaths) {
    const info = resolvePackageMeta(p);
    if (info) return info;
  }
  return null;
}

// 鉴权：能否读取（下载/预览）
function canRead(req, info) {
  if (!info) return false;
  if (info.visibility === 'public') return true;
  // private / hidden：仅管理员
  if (info.visibility === 'private' || info.visibility === 'hidden') {
    return !!(req.user && req.user.isAdmin);
  }
  // user-private：仅 owner 本人或管理员
  if (info.visibility === 'user-private') {
    if (!req.user) return false;
    if (req.user.isAdmin) return true;
    return info.owner === req.user.username;
  }
  return false;
}

// 鉴权：能否修改/删除
function canModify(req, info) {
  if (!info) return false;
  // 管理员可改任何文件
  if (req.user && req.user.isAdmin) return true;
  // user-private：仅 owner
  if (info.visibility === 'user-private' && req.user) {
    return info.owner === req.user.username;
  }
  return false;
}

// 中间件：加载目标文件信息并校验读权限
function authorizeRead(req, res, next) {
  const dirname = req.params.dirname;
  if (!dirname || dirname.includes('..') || dirname.includes('/') || dirname.includes('\\')) {
    return res.status(400).json({ code: 400, message: '非法的目录名' });
  }
  const info = locatePackageMeta(dirname);
  if (!info || !info.bodyPath) return res.status(404).json({ code: 404, message: '文件不存在' });
  if (!canRead(req, info)) {
    return res.status(403).json({ code: 403, message: '无权访问此文件' });
  }
  req.packageInfo = info;
  next();
}

// 中间件：加载目标文件信息并校验写权限
function authorizeModify(req, res, next) {
  const dirname = req.params.dirname;
  if (!dirname || dirname.includes('..') || dirname.includes('/') || dirname.includes('\\')) {
    return res.status(400).json({ code: 400, message: '非法的目录名' });
  }
  const info = locatePackageMeta(dirname);
  if (!info || !info.bodyPath) return res.status(404).json({ code: 404, message: '文件不存在' });
  if (!canModify(req, info)) {
    return res.status(403).json({ code: 403, message: '无权操作此文件' });
  }
  req.packageInfo = info;
  next();
}

// ============ 工具函数 ============

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseFilename(filename) {
  const ext = path.extname(filename);
  const name = filename.slice(0, filename.length - ext.length);
  let match = name.match(/^(.+?)[_\-（(【\[]+(.+?)[_\-）)】\]]*$/);
  if (match) {
    return { chineseName: match[1].trim(), version: match[2].trim(), extension: ext.slice(1).toUpperCase() };
  }
  match = name.match(/^(.+?)(v?\d[\w.\-]*)$/i);
  if (match && match[2]) {
    return { chineseName: match[1].trim(), version: match[2].trim(), extension: ext.slice(1).toUpperCase() };
  }
  return { chineseName: name, version: '-', extension: ext.slice(1).toUpperCase() || '-' };
}

// 字符串安全过滤：去掉危险字符 + 裁剪长度
function sanitizeText(str, maxLen) {
  if (str == null) return '';
  let s = String(str).replace(UNSAFE_CHAR_REGEX, '').trim();
  if (maxLen != null && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// 文件名安全过滤：防路径穿越 + 去危险字符
function sanitizeFilename(name) {
  if (name == null) return 'unnamed';
  let n = String(name).replace(/\\/g, '/');
  n = n.split('/').pop() || 'unnamed';
  n = n.replace(/[<>"'`|&;\\\x00-\x1f]/g, '_').replace(/^\.+/, '');
  if (!n || n === '.') n = 'unnamed';
  return n;
}

// 文件名中文转拼音（不带声调），非中文字符保留
function toPinyinFilename(filename) {
  const ext = path.extname(filename);
  const baseName = filename.slice(0, filename.length - ext.length);
  const parts = pinyin(baseName, { toneType: 'none', type: 'array' });
  return parts.join('') + ext;
}

// 判断文件名是否重复，重复就加 (1)(2) 后缀
function uniqueName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base}(${i})${ext || ''}`))) i++;
  return `${base}(${i})${ext || ''}`;
}

// ============ 子目录式存储 helper（新结构） ============
// 子目录命名规则：<文件名去扩展名>，特殊字符用 _ 替换
function safeDirname(filename) {
  const ext = path.extname(filename);
  let base = filename.slice(0, filename.length - ext.length);
  base = String(base).replace(/[<>"'`|&;\\/:*?\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  if (!base || base === '.') base = 'unnamed';
  return base;
}

// 判断目录是否为隐藏启动包（`#[原名]`）
function isHiddenPackageDir(name) {
  return /^#\[.+\]$/.test(name);
}

// 从隐藏包目录名提取原文件名（去 #[ ] 包裹）
function extractHiddenName(name) {
  const m = /^#\[(.+)\]$/.exec(name);
  return m ? m[1] : name;
}

// 说明文档扩展名集合（自动识别）
const DESC_EXTS = ['.md', '.markdown', '.txt', '.text', '.rst'];

function isDescDoc(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return DESC_EXTS.some((e) => lower.endsWith(e));
}

// 列出子目录条目：本体、说明、meta、其他
function listPackageEntries(dirPath) {
  const result = { body: null, description: null, meta: null, others: [] };
  if (!fs.existsSync(dirPath)) return result;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile()) {
      if (e.name === 'meta.json') { result.meta = e.name; continue; }
      if (e.name === 'package.json') { result.meta = e.name; continue; } // 隐藏启动用 package.json 当元数据
      if (isDescDoc(e.name)) {
        // 取第一个说明文档作为正文
        if (!result.description) result.description = e.name;
        else result.others.push(e.name);
        continue;
      }
      // 本体：取第一个非说明文件
      if (!result.body) result.body = e.name;
      else result.others.push(e.name);
    } else if (e.isDirectory()) {
      result.others.push(e.name + '/');
    }
  }
  return result;
}

// 取子目录本体文件绝对路径
function getPackageBodyPath(dirPath) {
  const entries = listPackageEntries(dirPath);
  if (entries.body) return path.join(dirPath, entries.body);
  return null;
}

// 读子目录 meta.json（隐藏启动用 package.json）
function readPackageMeta(dirPath) {
  const entries = listPackageEntries(dirPath);
  if (!entries.meta) return {};
  try {
    return JSON.parse(fs.readFileSync(path.join(dirPath, entries.meta), 'utf8')) || {};
  } catch (e) { return {}; }
}

// 读说明文档正文
function readPackageDescription(dirPath) {
  const entries = listPackageEntries(dirPath);
  if (!entries.description) return '';
  try {
    return fs.readFileSync(path.join(dirPath, entries.description), 'utf8');
  } catch (e) { return ''; }
}

// 列出压缩包条目（zip / tar.gz / 7z），返回 [{name, size, isDir}]
function listArchiveEntries(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  const result = [];
  try {
    if (base.endsWith('.zip')) {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      zip.getEntries().forEach((e) => {
        result.push({ name: e.entryName, size: e.header.size, isDir: e.isDirectory });
      });
    } else if (base.endsWith('.tar.gz') || base.endsWith('.tgz')) {
      const tar = require('tar');
      const list = [];
      // tar 同步读条目需要遍历
      tar.t({ file: filePath, sync: true, strict: true, onentry: (entry) => {
        list.push({ name: entry.path, size: entry.size || 0, isDir: entry.type === 'Directory' });
      } });
      list.forEach((x) => result.push(x));
    } else if (base.endsWith('.tar')) {
      const tar = require('tar');
      const list = [];
      tar.t({ file: filePath, sync: true, strict: true, onentry: (entry) => {
        list.push({ name: entry.path, size: entry.size || 0, isDir: entry.type === 'Directory' });
      } });
      list.forEach((x) => result.push(x));
    } else if (base.endsWith('.7z')) {
      // 7z 解析依赖外部 7zip 进程（可选，未安装则返回提示）
      result.push({ name: '[7z 需要系统安装 7z 命令]', size: 0, isDir: false, unsupported: true });
    }
  } catch (e) {
    result.push({ name: '[解析失败: ' + e.message + ']', size: 0, isDir: false, error: true });
  }
  return result;
}

// 判断目录/文件是否为压缩包
function isArchive(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar') || lower.endsWith('.7z');
}

// 读取元数据文件
function readMeta(pendingName) {
  const metaPath = path.join(PENDING_DIR, `${pendingName}.meta.json`);
  try {
    if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (e) {}
  return { description: '', uploadedAt: 0 };
}

// 写入元数据
function writeMeta(pendingName, meta) {
  const metaPath = path.join(PENDING_DIR, `${pendingName}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

// ============ multer 上传配置 ============
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PENDING_DIR),
  filename: (req, file, cb) => {
    // 修复 multer 默认 latin1 编码导致的中文文件名乱码
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeName = sanitizeFilename(originalName);
    const unique = uniqueName(PENDING_DIR, safeName);
    cb(null, unique);
  }
});
const upload = multer({
  storage: storage,
  limits: { fieldSize: 100 * 1024 * 1024 } // 不限制文件大小本身
});
// 上传支持多字段：本体（必选）+ 说明文档（可选）
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'descFile', maxCount: 1 }
]);

// 上传可用的标签预设（类似商标分类的勾选列表）
const PRESET_TAGS = [
  // 技术类（原）
  '操作系统', '办公软件', '开发工具', '设计制图', '数据库', '安全防护', '压缩解压',
  '影音播放', '驱动程序', '编程语言', '浏览器', '聊天通讯', '系统优化', '数据恢复',
  '虚拟机', '网络工具', '游戏工具', '教育学习', '财务办公', '科学计算', '图形图像',
  'AI 工具', '办公插件', '远程控制', '服务器软件', '中间件', 'IDE 集成环境',
  '调试工具', '终端工具', '版本控制', '镜像文件', '教程文档', '示例工程',
  // 非技术类（新增）
  '电影', '电视剧', '动漫', '二次元', '音乐', 'MV', '图片', '壁纸', '头像',
  '汽车', '摩托', '运动', '健身', '美食', '旅游', '摄影', '手办', '模型',
  '小说', '漫画', '杂志', '游戏存档', '游戏模组', '电子书', '字体', '音效',
  '素材', '模板', '纪录片', '课程', '讲座', '其他'
];

// ============ 通用文件列表 API（兼容老结构 + 新子目录结构） ============
app.get('/api/files', (req, res) => {
  try {
    const entries = fs.readdirSync(FILES_DIR, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.meta.json')) continue;
      const fullPath = path.join(FILES_DIR, entry.name);

      if (entry.isFile()) {
        // 老结构：直接放在 files 根的文件
        const stats = fs.statSync(fullPath);
        const parsed = parseFilename(entry.name);
        const metaPath = path.join(FILES_DIR, `${entry.name}.meta.json`);
        let description = '';
        let tags = [];
        try {
          if (fs.existsSync(metaPath)) {
            const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            description = m.description || '';
            tags = Array.isArray(m.tags) ? m.tags : [];
          }
        } catch (e) {}
        files.push({
          name: entry.name,
          dirname: null, // 老结构无 dirname
          chineseName: description || parsed.chineseName,
          version: parsed.version,
          extension: parsed.extension,
          description: description,
          tags: tags,
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          modified: stats.mtimeMs,
          modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN'),
          isPackage: false,
          downloadUrl: `/download/${encodeURIComponent(entry.name)}`,
          previewUrl: null
        });
      } else if (entry.isDirectory()) {
        // 新结构：files/<dirname>/ 子目录
        const pkgEntries = listPackageEntries(fullPath);
        if (!pkgEntries.body) continue; // 没有本体的目录跳过
        const bodyPath = path.join(fullPath, pkgEntries.body);
        let stats;
        try { stats = fs.statSync(bodyPath); } catch (e) { continue; }
        const parsed = parseFilename(pkgEntries.body);
        const meta = readPackageMeta(fullPath);
        files.push({
          name: pkgEntries.body,
          dirname: entry.name,
          chineseName: meta.description || parsed.chineseName,
          version: parsed.version,
          extension: parsed.extension,
          description: meta.description || '',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          modified: stats.mtimeMs,
          modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN'),
          isPackage: true,
          downloadUrl: `/download-dir/${encodeURIComponent(entry.name)}`,
          previewUrl: `/preview/${encodeURIComponent(entry.name)}`
        });
      }
    }
    files.sort((a, b) => b.modified - a.modified);
    res.json({ code: 0, message: 'success', data: { total: files.length, files } });
  } catch (err) {
    console.error('[错误] 读取文件列表失败:', err);
    res.status(500).json({ code: 500, message: '读取文件列表失败: ' + err.message });
  }
});

// ============ 下载（老结构兼容） ============
app.get('/download/:filename', (req, res) => {
  // 旧版直链：仅允许下载公开 files/ 目录下的散文件，私密/用户私有不再走这里
  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('非法的文件名');
  }
  const filePath = path.join(FILES_DIR, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).send('文件不存在');
  }
  streamFileDownload(req, res, filePath, filename);
});

// ============ 下载（新子目录结构，带所有权鉴权） ============
app.get('/download-dir/:dirname', authorizeRead, (req, res) => {
  // 鉴权已通过，req.packageInfo.bodyPath 即真实文件路径
  streamFileDownload(req, res, req.packageInfo.bodyPath, path.basename(req.packageInfo.bodyPath));
});

// 统一的下载流式响应（支持 Range 断点续传）
function streamFileDownload(req, res, actualPath, displayName) {
  const stats = fs.statSync(actualPath);
  if (!stats.isFile()) return res.status(400).send('不是有效的文件');
  const fileSize = stats.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(displayName)}`);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Requested Range Not Satisfiable');
    }
    if (isNaN(end) || end >= fileSize) end = fileSize - 1;
    if (start > end) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Requested Range Not Satisfiable');
    }
    const contentLength = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': contentLength,
      'Content-Type': 'application/octet-stream'
    });
    const stream = fs.createReadStream(actualPath, { start, end, highWaterMark: CHUNK_SIZE });
    stream.on('error', (err) => { console.error('[下载错误]', displayName, err.message); res.end(); });
    stream.pipe(res);
    console.log(`[断点续传] ${displayName} 范围: ${start}-${end}/${fileSize}`);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'application/octet-stream' });
    const stream = fs.createReadStream(actualPath, { highWaterMark: CHUNK_SIZE });
    stream.on('error', (err) => { console.error('[下载错误]', displayName, err.message); res.end(); });
    stream.pipe(res);
    console.log(`[开始下载] ${displayName} 大小: ${formatSize(fileSize)}`);
  }
}

// ============ 预览 API（新子目录结构） ============
// 定位子目录绝对路径（公开 → 私密 → 隐藏启动）
function locatePackageDir(dirname) {
  const tryPaths = [
    path.join(FILES_DIR, dirname),
    path.join(PRIVATE_FILES_DIR, dirname),
    path.join(PRIVATE_FILES_DIR, `#[${dirname}]`)
  ];
  for (const p of tryPaths) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

// 按扩展名给出默认封面类型（前端按类型选择 SVG 图标）
function coverTypeForExt(ext) {
  if (!ext) return 'unknown';
  const e = ext.toLowerCase();
  if (['exe', 'msi', 'app'].includes(e)) return 'exe';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(e)) return 'archive';
  if (['iso', 'dmg', 'img'].includes(e)) return 'disk';
  if (['pdf'].includes(e)) return 'pdf';
  if (['doc', 'docx'].includes(e)) return 'doc';
  if (['xls', 'xlsx'].includes(e)) return 'sheet';
  if (['ppt', 'pptx'].includes(e)) return 'slides';
  if (['txt', 'md', 'markdown', 'rst'].includes(e)) return 'text';
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'].includes(e)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(e)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(e)) return 'image';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sh', 'bat'].includes(e)) return 'code';
  if (['html', 'htm', 'css'].includes(e)) return 'web';
  return 'unknown';
}

app.get('/api/preview/:dirname', authorizeRead, (req, res) => {
  // 鉴权已通过，req.packageInfo 含 dirPath / bodyPath / meta
  const info = req.packageInfo;
  const dirPath = info.dirPath;
  const dirname = req.params.dirname;

  const pkgEntries = listPackageEntries(dirPath);
  if (!pkgEntries.body) return res.status(404).json({ code: 404, message: '包内未找到本体文件' });
  const bodyPath = info.bodyPath;
  const bodyStats = fs.statSync(bodyPath);
  const meta = info.meta;
  const parsed = parseFilename(pkgEntries.body);
  const isHidden = isHiddenPackageDir(path.basename(dirPath));

  // 子目录条目（others 数组）
  const others = (pkgEntries.others || []).map((n) => {
    const isDir = n.endsWith('/');
    const cleanName = isDir ? n.slice(0, -1) : n;
    let size = 0;
    try { size = fs.statSync(path.join(dirPath, cleanName)).size; } catch (e) {}
    return { name: n, size: size, isDir: isDir };
  });

  // 如果本体是压缩包，列出条目
  let archiveEntries = null;
  if (isArchive(pkgEntries.body)) {
    archiveEntries = listArchiveEntries(bodyPath);
  }

  res.json({
    code: 0,
    data: {
      dirname: dirname,
      isHidden: isHidden,
      body: {
        name: pkgEntries.body,
        extension: parsed.extension,
        size: bodyStats.size,
        sizeFormatted: formatSize(bodyStats.size),
        modified: bodyStats.mtimeMs,
        modifiedFormatted: new Date(bodyStats.mtimeMs).toLocaleString('zh-CN'),
        cover: coverTypeForExt(parsed.extension),
        isArchive: isArchive(pkgEntries.body)
      },
      title: meta.description || parsed.chineseName,
      description: meta.description || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      docContent: readPackageDescription(dirPath),
      docName: pkgEntries.description || '',
      entries: others,
      archiveEntries: archiveEntries,
      downloadUrl: `/download-dir/${encodeURIComponent(dirname)}`
    }
  });
});

// ============ 上传 API ============
// ============================================================================
// 分片上传协议（4 个接口）
//   POST /api/upload/check   秒传检查：根据 fileMd5 查指纹表，命中则直接复制记录
//   POST /api/upload/init    初始化上传会话（返回 uploadId + 已上传分片列表）
//   POST /api/upload/chunk   上传单个分片（multipart，含 uploadId/index/分片二进制）
//   POST /api/upload/merge   合并所有分片（stream.pipeline 流式合并，不读入内存）
// ============================================================================

// 通用：上传会话所有权校验（防越权操作他人会话）
function ownsUploadSession(req, sess) {
  if (!sess) return false;
  if (req.user && req.user.isAdmin) return true;
  if (sess.visibility === 'user-private') {
    return req.user && sess.user_id === req.user.id;
  }
  return true; // public/private/hidden 任何人都能传
}

// 通用：把合并后的文件落地到对应目录（公开→pending 待审 / 用户私有→用户目录）
// 返回 { targetDir, bodyFilename, visibility, owner }
function finalizeUploadedFile(sess, mergedPath, descDocPath) {
  const originalName = sess.file_name;
  const visibility = sess.visibility;
  const tags = (() => { try { return JSON.parse(sess.tags || '[]'); } catch (e) { return []; } })();
  const description = sess.description || '';
  // v3.0：文件说明文本（前端文本框输入，存于 desc_text 列）
  const descTextVal = sess.desc_text || '';

  if (visibility === 'user-private') {
    const username = sess.username;
    const userDir = userPrivateDir(username);
    try { fs.mkdirSync(userDir, { recursive: true }); } catch (e) {}
    const dirBase = safeDirname(originalName);
    const targetDir = path.join(userDir, uniqueName(userDir, dirBase));
    fs.mkdirSync(targetDir, { recursive: true });
    // 文件本体落盘名：用 pinyin 处理中文，避免文件系统编码问题
    const ext = path.extname(originalName);
    const baseName = toPinyinFilename(originalName);
    const bodyFilename = uniqueName(targetDir, baseName);
    const bodyTarget = path.join(targetDir, bodyFilename);
    // 移动合并后的文件
    fs.renameSync(mergedPath, bodyTarget);
    // 写文件说明：优先用 desc_text 生成 说明.md；否则用上传的描述文档
    let descDocName = '';
    if (descTextVal) {
      try {
        fs.writeFileSync(path.join(targetDir, '说明.md'), descTextVal, 'utf8');
        descDocName = '说明.md';
      } catch (e) {}
    } else if (descDocPath && fs.existsSync(descDocPath)) {
      const descExt = path.extname(descDocPath) || '.md';
      try {
        fs.renameSync(descDocPath, path.join(targetDir, `说明${descExt}`));
        descDocName = `说明${descExt}`;
      } catch (e) {}
    }
    // 写元数据
    const pkgMeta = {
      description: description,
      tags: tags,
      originalName: originalName,
      body: bodyFilename,
      visibility: 'user-private',
      owner: username,
      approvedAt: Date.now()
    };
    fs.writeFileSync(path.join(targetDir, 'meta.json'), JSON.stringify(pkgMeta, null, 2), 'utf8');
    return { targetDir, bodyFilename, visibility, owner: username, dirname: path.basename(targetDir) };
  } else {
    // public / private / hidden → pending 待审核
    const baseName = toPinyinFilename(originalName);
    const bodyFilename = uniqueName(PENDING_DIR, baseName);
    const bodyTarget = path.join(PENDING_DIR, bodyFilename);
    fs.renameSync(mergedPath, bodyTarget);
    let descDocName = '';
    if (descTextVal) {
      // v3.0：用 desc_text 生成 说明.md（待审核区命名为 <bodyFilename>.说明.md）
      descDocName = `${bodyFilename}.说明.md`;
      try {
        fs.writeFileSync(path.join(PENDING_DIR, descDocName), descTextVal, 'utf8');
      } catch (e) {}
    } else if (descDocPath && fs.existsSync(descDocPath)) {
      const descExt = path.extname(descDocPath) || '.md';
      descDocName = `${bodyFilename}.说明${descExt}`;
      try {
        fs.renameSync(descDocPath, path.join(PENDING_DIR, descDocName));
      } catch (e) {}
    }
    const meta = {
      description: description,
      originalName: originalName,
      visibility: visibility,
      tags: tags,
      hasDescriptionDoc: !!descDocName,
      descDocName: descDocName,
      uploadedAt: Date.now(),
      size: sess.file_size,
      sizeFormatted: formatSize(sess.file_size),
      overSuggested: sess.file_size > SUGGEST_MAX_SIZE
    };
    writeMeta(bodyFilename, meta);
    return { targetDir: PENDING_DIR, bodyFilename, visibility, owner: null, dirname: bodyFilename };
  }
}

// ---- 接口 1：秒传检查 ----
app.post('/api/upload/check', (req, res) => {
  const { fileMd5, fileSize, visibility } = req.body || {};
  if (!fileMd5 || !fileSize) return res.status(400).json({ code: 400, message: '缺少 fileMd5 或 fileSize' });
  let vis = 'public';
  if (visibility === 'private') vis = 'private';
  else if (visibility === 'hidden') vis = 'hidden';
  else if (visibility === 'user-private') vis = 'user-private';

  // user-private 秒传需要登录
  if (vis === 'user-private' && !req.user) {
    return res.status(401).json({ code: 401, message: '仅自己可见的文件需要先登录' });
  }
  if (vis === 'user-private' && req.user.uploadLocked) {
    return res.status(403).json({ code: 403, message: '上传通道已锁死：超出 1GB 配额' });
  }

  // 查指纹（联合 file_md5 + file_size，防哈希碰撞；user-private 限同用户）
  const userId = vis === 'user-private' ? req.user.id : 0;
  const fp = db.getFingerprintForUser(fileMd5, fileSize, userId);
  if (!fp) return res.json({ code: 0, data: { instant: false } });

  // 二次校验文件大小（理论上 DB 已联合查询，但稳妥起见再比一次）
  if (fp.file_size !== fileSize) {
    return res.json({ code: 0, data: { instant: false } });
  }

  // 命中：检查目标文件还在不在
  if (!fs.existsSync(fp.target_dir)) {
    // 文件已被删，清理过期指纹
    db.deleteFingerprintByDir(fp.target_dir);
    return res.json({ code: 0, data: { instant: false } });
  }

  // user-private 秒传：复制一份到自己目录
  if (vis === 'user-private') {
    const userDir = userPrivateDir(req.user.username);
    try { fs.mkdirSync(userDir, { recursive: true }); } catch (e) {}
    const dirBase = safeDirname(fp.file_name);
    const targetDir = path.join(userDir, uniqueName(userDir, dirBase));
    fs.mkdirSync(targetDir, { recursive: true });
    // 复制原目录下的所有文件
    for (const entry of fs.readdirSync(fp.target_dir)) {
      const src = path.join(fp.target_dir, entry);
      const dst = path.join(targetDir, entry);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dst);
    }
    // 改写 meta.json 的 owner
    const metaPath = path.join(targetDir, 'meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8') || '{}'); } catch (e) {}
    meta.owner = req.user.username;
    meta.visibility = 'user-private';
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    // 配额校验
    const used = userUsedBytes(req.user.username);
    let locked = false;
    if (used > USER_QUOTA_BYTES) {
      db.setUploadLocked(req.user.id, true);
      locked = true;
    }
    // 登记新指纹
    db.addFingerprint({
      fileMd5, fileSize: fp.file_size, fileName: fp.file_name,
      targetDir, visibility: 'user-private', userId: req.user.id, username: req.user.username
    });
    console.log(`[秒传-用户私密] ${req.user.username}/${path.basename(targetDir)} ${formatSize(fp.file_size)}`);
    return res.json({
      code: 0,
      data: {
        instant: true,
        dirname: path.basename(targetDir),
        size: fp.file_size,
        sizeFormatted: formatSize(fp.file_size),
        usedBytes: used, usedFormatted: formatSize(used),
        quotaBytes: USER_QUOTA_BYTES, quotaFormatted: formatSize(USER_QUOTA_BYTES),
        uploadLocked: locked,
        pendingMessage: locked
          ? '秒传成功，但已超出 1GB 配额，上传通道已锁死'
          : '秒传成功：服务器已有相同文件，已直接复制到你的我的云盘'
      }
    });
  }

  // public/private/hidden 不支持秒传（因为需要审核流程，且可能被拒）
  return res.json({ code: 0, data: { instant: false } });
});

// ---- 接口 2：初始化上传会话 ----
app.post('/api/upload/init', (req, res) => {
  const { fileMd5, fileName, fileSize, chunkSize, totalChunks, visibility, description, tags, descText } = req.body || {};
  if (!fileMd5 || !fileName || !fileSize || !totalChunks) {
    return res.status(400).json({ code: 400, message: '缺少必要参数' });
  }
  let vis = 'public';
  if (visibility === 'private') vis = 'private';
  else if (visibility === 'hidden') vis = 'hidden';
  else if (visibility === 'user-private') vis = 'user-private';

  if (vis === 'user-private') {
    if (!req.user) return res.status(401).json({ code: 401, message: '仅自己可见的文件需要先登录' });
    if (req.user.uploadLocked) return res.status(403).json({ code: 403, message: '上传通道已锁死' });
  }
  const cs = Math.min(parseInt(chunkSize, 10) || DEFAULT_CHUNK_SIZE, CHUNK_MAX_SIZE);
  if (cs < 64 * 1024) return res.status(400).json({ code: 400, message: '分片大小不能小于 64KB' });
  const tc = parseInt(totalChunks, 10);
  if (tc <= 0 || tc > 100000) return res.status(400).json({ code: 400, message: '分片数非法' });

  // 生成 uploadId
  const uploadId = crypto.randomBytes(16).toString('hex');
  // 标签处理
  let tagArr = [];
  if (Array.isArray(tags)) tagArr = tags.map((t) => sanitizeText(t, 20)).filter(Boolean);
  else if (typeof tags === 'string') {
    try { tagArr = JSON.parse(tags).map((t) => sanitizeText(t, 20)).filter(Boolean); }
    catch (e) { tagArr = tags.split(',').map((t) => sanitizeText(t, 20)).filter(Boolean); }
  }
  if (tagArr.length === 0) return res.status(400).json({ code: 400, message: '请至少选择一个文件标签' });
  if (tagArr.length > 10) tagArr = tagArr.slice(0, 10);
  const desc = sanitizeText(description || '', MAX_DESC_LENGTH);
  // 文件说明文本（v3.0：必填，100-200 字，服务端做基础校验和清洗）
  let descTextVal = '';
  if (descText && typeof descText === 'string') {
    // 清洗：去掉控制字符和 HTML 标签
    descTextVal = descText.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/g, '').trim();
    if (descTextVal.length > 200) descTextVal = descTextVal.slice(0, 200);
  }
  if (descTextVal.length < 10) {
    return res.status(400).json({ code: 400, message: '文件说明不能为空，且至少 10 个字' });
  }

  // 检查是否有同 MD5 的未完成会话（断点续传）
  const existing = db.getUploadSessionByMd5(fileMd5, vis === 'user-private' ? req.user.id : null);
  if (existing && existing.status === 'uploading') {
    // 检查分片目录还在不在
    const sessDir = path.join(CHUNK_UPLOAD_DIR, existing.upload_id);
    if (fs.existsSync(sessDir)) {
      // 崩溃恢复：内存缓存丢失过，反查文件系统拿真实已上传分片
      // 已上传分片以文件名 00000000、00000001... 形式落盘
      const realUploaded = [];
      try {
        const files = fs.readdirSync(sessDir);
        for (const f of files) {
          if (/^\d{8}$/.test(f)) {
            const idx = parseInt(f, 10);
            if (idx >= 0 && idx < existing.total_chunks) realUploaded.push(idx);
          }
        }
        realUploaded.sort((a, b) => a - b);
      } catch (e) {}
      // 用文件系统的真实状态重置内存缓存（覆盖可能的脏数据）
      db.resetChunkCache(existing.upload_id, realUploaded);
      // 也把 DB 里的 uploaded_chunks 同步成真实状态
      db.flushChunks(existing.upload_id);
      console.log(`[断点续传] 命中会话 ${existing.upload_id} 真实已传 ${realUploaded.length}/${existing.total_chunks}`);
      return res.json({
        code: 0,
        data: {
          uploadId: existing.upload_id,
          uploadedChunks: realUploaded,
          totalChunks: existing.total_chunks,
          chunkSize: existing.chunk_size,
          resumed: true
        }
      });
    }
    // 目录已丢失，删旧会话
    db.deleteUploadSession(existing.upload_id);
    db.clearChunkCache(existing.upload_id);
  }

  // 创建新会话
  db.createUploadSession({
    uploadId, fileMd5, fileName, fileSize, chunkSize: cs, totalChunks: tc,
    visibility: vis, userId: vis === 'user-private' ? req.user.id : null,
    username: vis === 'user-private' ? req.user.username : null,
    description: desc, tags: JSON.stringify(tagArr), descText: descTextVal
  });
  // 创建分片暂存目录
  const sessDir = path.join(CHUNK_UPLOAD_DIR, uploadId);
  fs.mkdirSync(sessDir, { recursive: true });
  console.log(`[上传初始化] ${uploadId} ${fileName} ${formatSize(fileSize)} ${cs / 1024 / 1024}MB×${tc}片 ${vis}`);
  res.json({
    code: 0,
    data: {
      uploadId, uploadedChunks: [], totalChunks: tc, chunkSize: cs, resumed: false
    }
  });
});

// ---- 接口 3：上传单个分片 ----
// multer 单文件，限制 10MB，落盘到 chunks/<uploadId>/<index>
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    if (!uploadId) return cb(new Error('缺少 uploadId'));
    const sessDir = path.join(CHUNK_UPLOAD_DIR, uploadId);
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    cb(null, sessDir);
  },
  filename: (req, file, cb) => {
    const index = parseInt(req.body.index, 10);
    if (isNaN(index) || index < 0) return cb(new Error('分片索引非法'));
    cb(null, String(index).padStart(8, '0'));
  }
});
const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: CHUNK_MAX_SIZE + 1024 } // 留点余量
});

app.post('/api/upload/chunk', chunkUpload.single('chunk'), (req, res) => {
  const uploadId = req.body.uploadId;
  const index = parseInt(req.body.index, 10);
  if (!uploadId || isNaN(index) || index < 0) {
    return res.status(400).json({ code: 400, message: '缺少 uploadId 或 index' });
  }
  const sess = db.getUploadSession(uploadId);
  if (!sess) return res.status(404).json({ code: 404, message: '上传会话不存在或已过期' });
  if (sess.status !== 'uploading') {
    return res.status(400).json({ code: 400, message: `会话状态为 ${sess.status}，不能上传分片` });
  }
  // 所有权校验
  if (!ownsUploadSession(req, sess)) {
    // 删掉刚落盘的越权分片
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(403).json({ code: 403, message: '无权操作此上传会话' });
  }
  if (index >= sess.total_chunks) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json({ code: 400, message: '分片索引越界' });
  }
  // 分片大小校验（最后一片可以小于 chunkSize）
  const expectedSize = index === sess.total_chunks - 1
    ? sess.file_size - (sess.total_chunks - 1) * sess.chunk_size
    : sess.chunk_size;
  if (req.file.size < expectedSize - 1024 || req.file.size > expectedSize + 1024) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json({ code: 400, message: `分片大小不匹配（期望 ${expectedSize}，实际 ${req.file.size}）` });
  }
  // 记录已上传
  const uploaded = db.markChunkUploaded(uploadId, index);
  return res.json({
    code: 0,
    data: { uploadId, index, uploadedChunks: uploaded, totalChunks: sess.total_chunks }
  });
});

// ---- 接口 4：合并所有分片 ----
const pipeline = stream.promises.pipeline;

app.post('/api/upload/merge', express.json(), async (req, res) => {
  const { uploadId, descDoc } = req.body || {};
  if (!uploadId) return res.status(400).json({ code: 400, message: '缺少 uploadId' });
  const sess = db.getUploadSession(uploadId);
  if (!sess) return res.status(404).json({ code: 404, message: '上传会话不存在' });
  if (!ownsUploadSession(req, sess)) return res.status(403).json({ code: 403, message: '无权操作此上传会话' });

  // 关键：合并前先把内存缓存 flush 到 DB
  db.flushChunks(uploadId);
  // 重新读取 session 拿到最新 uploaded_chunks
  const sessLatest = db.getUploadSession(uploadId);
  let uploaded = [];
  try { uploaded = JSON.parse(sessLatest.uploaded_chunks || '[]'); } catch (e) {}
  if (uploaded.length !== sessLatest.total_chunks) {
    return res.status(400).json({ code: 400, message: `分片未传完：${uploaded.length}/${sessLatest.total_chunks}` });
  }
  if (sessLatest.status === 'completed') {
    return res.json({ code: 0, message: '已合并完成', data: { dirname: sessLatest.target_dir } });
  }

  db.setUploadStatus(uploadId, 'merging', null);
  const sessDir = path.join(CHUNK_UPLOAD_DIR, uploadId);
  const mergedPath = path.join(sessDir, 'merged.bin');

  try {
    // 流式合并：依次创建每个分片的可读流，pipe 到合并文件
    const writeStream = fs.createWriteStream(mergedPath, { highWaterMark: 4 * 1024 * 1024 });
    for (let i = 0; i < sessLatest.total_chunks; i++) {
      const chunkPath = path.join(sessDir, String(i).padStart(8, '0'));
      if (!fs.existsSync(chunkPath)) throw new Error(`分片 ${i} 不存在`);
      const readStream = fs.createReadStream(chunkPath, { highWaterMark: 4 * 1024 * 1024 });
      // 用 stream.pipeline 把单片写入合并文件（不等内存）
      await pipeline(readStream, writeStream, { end: false });
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // 校验合并后大小
    const mergedSize = fs.statSync(mergedPath).size;
    if (mergedSize !== sessLatest.file_size) {
      throw new Error(`合并后大小不匹配（期望 ${sessLatest.file_size}，实际 ${mergedSize}）`);
    }

    // 校验文件指纹（SHA-256，前端字段名仍叫 fileMd5 但实际是 SHA-256）
    const hash = crypto.createHash('sha256');
    const checkStream = fs.createReadStream(mergedPath, { highWaterMark: 4 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      checkStream.on('data', (d) => hash.update(d));
      checkStream.on('end', resolve);
      checkStream.on('error', reject);
    });
    const actualMd5 = hash.digest('hex');
    if (actualMd5 !== sessLatest.file_md5) {
      throw new Error(`文件指纹校验失败（期望 ${sessLatest.file_md5}，实际 ${actualMd5}）`);
    }

    // 处理描述文档：前端如已通过 /api/upload/desc 上传，则文件在 sessDir/descDoc.<ext>
    // v3.0：优先使用 desc_text（前端文本框输入），写入 说明.md
    let descDocPath = null;
    try {
      const entries = fs.readdirSync(sessDir);
      const descFile = entries.find((n) => n.startsWith('descDoc'));
      if (descFile) descDocPath = path.join(sessDir, descFile);
    } catch (e) {}

    // 落地到最终目录（传入 desc_text，由 finalize 写入 说明.md）
    const result = finalizeUploadedFile(sessLatest, mergedPath, descDocPath);

    // 登记指纹（用于下次秒传，联合 file_md5 + file_size）
    db.addFingerprint({
      fileMd5: sessLatest.file_md5, fileSize: sessLatest.file_size, fileName: sessLatest.file_name,
      targetDir: result.targetDir, visibility: sessLatest.visibility,
      userId: sessLatest.user_id, username: sessLatest.username
    });

    // 标记完成
    db.setUploadStatus(uploadId, 'completed', result.targetDir);
    // 清理内存缓存
    db.clearChunkCache(uploadId);

    // 清理分片暂存目录
    try { fs.rmSync(sessDir, { recursive: true, force: true }); } catch (e) {}

    // user-private：配额校验
    let locked = false;
    let used = 0;
    if (sessLatest.visibility === 'user-private' && sessLatest.user_id) {
      used = userUsedBytes(sessLatest.username);
      if (used > USER_QUOTA_BYTES) {
        db.setUploadLocked(sessLatest.user_id, true);
        locked = true;
      }
    }

    console.log(`[上传完成] ${sessLatest.file_name} ${formatSize(sessLatest.file_size)} ${sessLatest.visibility} ${result.dirname}`);
    res.json({
      code: 0,
      message: '上传成功',
      data: {
        dirname: result.dirname,
        size: sessLatest.file_size,
        sizeFormatted: formatSize(sessLatest.file_size),
        visibility: sessLatest.visibility,
        usedBytes: used, usedFormatted: formatSize(used),
        quotaBytes: USER_QUOTA_BYTES, quotaFormatted: formatSize(USER_QUOTA_BYTES),
        uploadLocked: locked,
        pendingMessage: sessLatest.visibility === 'user-private'
          ? (locked ? '文件已保存到你的我的云盘，但已超出 1GB 配额，上传通道已锁死' : '文件已保存到你的我的云盘，无需审核即可下载')
          : '文件已上传，等待管理员审核通过'
      }
    });
  } catch (e) {
    console.error('[合并失败]', uploadId, e.message);
    db.setUploadStatus(uploadId, 'failed', null);
    res.status(500).json({ code: 500, message: '合并失败: ' + e.message });
  }
});

// ---- 接口 5：上传描述文档（独立 multipart，合并前调用）----
const descStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    if (!uploadId) return cb(new Error('缺少 uploadId'));
    const sessDir = path.join(CHUNK_UPLOAD_DIR, uploadId);
    if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });
    cb(null, sessDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'descDoc' + (path.extname(file.originalname) || '.md'));
  }
});
const descUpload = multer({ storage: descStorage, limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/api/upload/desc', descUpload.single('descFile'), (req, res) => {
  const uploadId = req.body.uploadId;
  if (!uploadId) return res.status(400).json({ code: 400, message: '缺少 uploadId' });
  const sess = db.getUploadSession(uploadId);
  if (!sess) return res.status(404).json({ code: 404, message: '上传会话不存在' });
  if (!ownsUploadSession(req, sess)) return res.status(403).json({ code: 403, message: '无权操作此上传会话' });
  res.json({ code: 0, data: { path: req.file.path } });
});

// 兼容旧接口：保留 /api/upload 作为简易上传入口（内部走分片协议）
// 注意：旧接口不再处理大文件，仅保留为兼容标记，前端应改用分片协议
app.post('/api/upload', (req, res) => {
  return res.status(410).json({
    code: 410,
    message: '此接口已弃用，请使用分片上传协议：/api/upload/check → /api/upload/init → /api/upload/chunk → /api/upload/merge'
  });
});

// 上传配置（给前端显示提醒信息 + 可用标签）
app.get('/api/upload-config', (req, res) => {
  res.json({
    code: 0,
    data: {
      suggestMaxSize: SUGGEST_MAX_SIZE,
      suggestMaxSizeFormatted: formatSize(SUGGEST_MAX_SIZE),
      maxDescLength: MAX_DESC_LENGTH,
      presetTags: PRESET_TAGS,
      hint: '建议文件不超过 2GB，超过仍可上传但可能审核更严'
    }
  });
});

// ============ 管理员鉴权中间件 ============
function checkAdmin(req, res, next) {
  const pwd = req.query.pwd || req.headers['x-admin-pwd'] || (req.body && req.body.pwd);
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ code: 401, message: '管理员密码错误' });
  }
  next();
}

// ============ 审核 API ============

// 查看待审核列表
app.get('/api/admin/pending', checkAdmin, (req, res) => {
  try {
    const entries = fs.readdirSync(PENDING_DIR, { withFileTypes: true });
    const files = [];
    const seen = new Set(); // 用于跳过说明文档（filename.说明.xxx）
    // 先扫一遍标记说明文档
    for (const e of entries) {
      if (e.isFile()) {
        const baseMatch = e.name.match(/^(.+)\.说明\.[^.]+$/);
        if (baseMatch) seen.add(baseMatch[1]);
      }
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.meta.json')) continue;
      if (entry.name.match(/\.说明\.[^.]+$/)) continue; // 说明文档不在列表里展示
      const fullPath = path.join(PENDING_DIR, entry.name);
      if (!fs.statSync(fullPath).isFile()) continue;
      const meta = readMeta(entry.name);
      const stats = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        description: meta.description || '',
        originalName: meta.originalName || entry.name,
        visibility: meta.visibility || 'public',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        hasDescriptionDoc: !!meta.hasDescriptionDoc,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        uploadedAt: meta.uploadedAt || stats.ctimeMs,
        uploadedAtFormatted: new Date(meta.uploadedAt || stats.ctimeMs).toLocaleString('zh-CN'),
        overSuggested: stats.size > SUGGEST_MAX_SIZE
      });
    }
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);
    res.json({ code: 0, data: { total: files.length, files } });
  } catch (err) {
    console.error('[错误] 读取待审核列表失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 审核通过：移动到 files 目录（新结构：子目录）
app.post('/api/admin/approve', checkAdmin, express.json(), (req, res) => {
  const filename = sanitizeFilename(req.body && req.body.filename);
  if (!filename) return res.status(400).json({ code: 400, message: '缺少文件名' });

  const src = path.join(PENDING_DIR, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ code: 404, message: '待审核文件不存在' });

  const meta = readMeta(filename);
  let visibility = 'public';
  if (meta.visibility === 'private') visibility = 'private';
  else if (meta.visibility === 'hidden') visibility = 'hidden';

  // 子目录名（隐藏启动用 #[原名] 包裹）
  let dirBase = safeDirname(meta.originalName || filename);
  if (visibility === 'hidden') {
    // 隐藏启动：dirname = #[原名去扩展名]
    dirBase = `#[${dirBase}]`;
  } else if (visibility === 'private') {
    // 普通私密：中文转拼音让 URL 更干净
    dirBase = safeDirname(toPinyinFilename(meta.originalName || filename));
  }
  const targetRoot = (visibility === 'public') ? FILES_DIR : PRIVATE_FILES_DIR;
  let dirname = uniqueName(targetRoot, dirBase);
  const targetDir = path.join(targetRoot, dirname);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // 移动本体
    const destBody = path.join(targetDir, filename);
    fs.renameSync(src, destBody);

    // 移动说明文档（如果上传时附带）
    if (meta.hasDescriptionDoc) {
      // 找 pending 里 <filename>.说明.<ext>
      const candidates = fs.readdirSync(PENDING_DIR).filter((n) =>
        n.startsWith(filename + '.说明.')
      );
      for (const descName of candidates) {
        const ext = path.extname(descName);
        const newDescName = `说明${ext}`;
        try {
          fs.renameSync(path.join(PENDING_DIR, descName), path.join(targetDir, newDescName));
        } catch (e) { /* 忽略 */ }
      }
    }

    // 写子目录元数据：隐藏启动用 package.json，其他用 meta.json
    const desc = sanitizeText(meta.description || '', MAX_DESC_LENGTH);
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const pkgMeta = {
      description: desc,
      tags: tags,
      originalName: meta.originalName || filename,
      body: filename,
      visibility: visibility,
      approvedAt: Date.now()
    };
    const metaFileName = (visibility === 'hidden') ? 'package.json' : 'meta.json';
    fs.writeFileSync(path.join(targetDir, metaFileName), JSON.stringify(pkgMeta, null, 2), 'utf8');

    // 删除旧的元数据文件
    const oldMeta = path.join(PENDING_DIR, `${filename}.meta.json`);
    if (fs.existsSync(oldMeta)) fs.unlinkSync(oldMeta);
    console.log(`[审核通过] ${filename} → ${dirname} → ${targetRoot} 描述:${desc} 标签:${tags.join('/')} 可见性:${visibility}`);
    let msg = '审核通过，文件已加入下载列表';
    if (visibility === 'private') msg = '审核通过，文件已加入私密文件列表';
    if (visibility === 'hidden') msg = '审核通过，文件已配置为隐藏启动';
    res.json({ code: 0, message: msg, data: { dirname: dirname, visibility: visibility } });
  } catch (err) {
    console.error('[审核通过失败]', err);
    res.status(500).json({ code: 500, message: '审核失败: ' + err.message });
  }
});

// ============ 私密文件列表（仅管理员可见） ============
app.get('/api/admin/private-list', checkAdmin, (req, res) => {
  try {
    const entries = fs.readdirSync(PRIVATE_FILES_DIR, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.meta.json')) continue;
      const fullPath = path.join(PRIVATE_FILES_DIR, entry.name);
      const stats = fs.statSync(fullPath);

      if (entry.isFile()) {
        // 老结构私密文件（直接放根）
        const metaPath = path.join(PRIVATE_FILES_DIR, `${entry.name}.meta.json`);
        let description = '';
        let tags = [];
        try {
          if (fs.existsSync(metaPath)) {
            const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            description = m.description || '';
            tags = Array.isArray(m.tags) ? m.tags : [];
          }
        } catch (e) {}
        const parsed = parseFilename(entry.name);
        files.push({
          name: entry.name,
          dirname: null,
          chineseName: description || parsed.chineseName,
          description: description,
          tags: tags,
          version: parsed.version,
          extension: parsed.extension,
          size: stats.size,
          sizeFormatted: formatSize(stats.size),
          modified: stats.mtimeMs,
          modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN'),
          isPackage: false,
          isHidden: false,
          downloadUrl: `/download/${encodeURIComponent(entry.name)}`
        });
      } else if (entry.isDirectory()) {
        // 新结构：私密子目录 或 隐藏启动 #[原名]
        const pkgEntries = listPackageEntries(fullPath);
        if (!pkgEntries.body) continue;
        const bodyPath = path.join(fullPath, pkgEntries.body);
        let bodyStats;
        try { bodyStats = fs.statSync(bodyPath); } catch (e) { continue; }
        const meta = readPackageMeta(fullPath);
        const isHidden = isHiddenPackageDir(entry.name);
        const displayName = isHidden ? extractHiddenName(entry.name) : entry.name;
        const parsed = parseFilename(pkgEntries.body);
        files.push({
          name: pkgEntries.body,
          dirname: entry.name,
          chineseName: meta.description || displayName,
          description: meta.description || '',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          version: parsed.version,
          extension: parsed.extension,
          size: bodyStats.size,
          sizeFormatted: formatSize(bodyStats.size),
          modified: bodyStats.mtimeMs,
          modifiedFormatted: new Date(bodyStats.mtimeMs).toLocaleString('zh-CN'),
          isPackage: true,
          isHidden: isHidden,
          downloadUrl: `/download-dir/${encodeURIComponent(displayName)}`
        });
      }
    }
    files.sort((a, b) => b.modified - a.modified);
    res.json({ code: 0, data: { total: files.length, files } });
  } catch (err) {
    console.error('[错误] 读取私密文件列表失败:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 审核拒绝：删除 pending 目录中的文件
app.post('/api/admin/reject', checkAdmin, express.json(), (req, res) => {
  const filename = sanitizeFilename(req.body && req.body.filename);
  if (!filename) return res.status(400).json({ code: 400, message: '缺少文件名' });
  const filePath = path.join(PENDING_DIR, filename);
  const metaPath = path.join(PENDING_DIR, `${filename}.meta.json`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    // 同时删除可能附带的说明文档 <filename>.说明.<ext>
    const descCandidates = fs.readdirSync(PENDING_DIR).filter((n) => n.startsWith(filename + '.说明.'));
    descCandidates.forEach((n) => {
      try { fs.unlinkSync(path.join(PENDING_DIR, n)); } catch (e) {}
    });
    console.log(`[审核拒绝] 删除 ${filename}`);
    res.json({ code: 0, message: '已拒绝并删除文件' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '删除失败: ' + err.message });
  }
});

// 查看审核状态（给普通用户看：自己上传了多少个待审核）
app.get('/api/pending-count', (req, res) => {
  try {
    const entries = fs.readdirSync(PENDING_DIR, { withFileTypes: true });
    let count = 0;
    for (const e of entries) {
      if (!e.name.startsWith('.') && !e.name.endsWith('.meta.json') && e.isFile()) {
        // 跳过说明文档
        if (e.name.match(/\.说明\.[^.]+$/)) continue;
        count++;
      }
    }
    res.json({ code: 0, data: { pendingCount: count } });
  } catch (e) { res.json({ code: 0, data: { pendingCount: 0 } }); }
});

// ============ 健康检查 ============
app.get('/api/health', (req, res) => {
  res.json({ code: 0, status: 'ok', timestamp: Date.now() });
});

// ============ 公告 API ============
function readAnnouncements() {
  try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8')) || [];
    }
  } catch (e) { console.error('[公告] 读取失败:', e.message); }
  return [];
}
function writeAnnouncements(list) {
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// 公告类型常量
const ANNOUNCEMENT_TYPES = ['maintenance', 'release', 'normal'];

// 普通用户拉取公告列表
app.get('/api/announcements', (req, res) => {
  const list = readAnnouncements()
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({
    code: 0,
    data: {
      total: list.length,
      announcements: list
    }
  });
});

// 管理员发布 / 修改 / 删除公告
app.post('/api/admin/announcement', checkAdmin, (req, res) => {
  const action = (req.body && req.body.action) || 'create';
  if (action === 'create') {
    const title = sanitizeText(req.body.title || '', 80);
    const content = sanitizeText(req.body.content || '', 1000);
    const type = ANNOUNCEMENT_TYPES.includes(req.body.type) ? req.body.type : 'normal';
    if (!title || !content) return res.status(400).json({ code: 400, message: '标题和内容不能为空' });
    const list = readAnnouncements();
    const item = {
      id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
      title, content, type,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    list.push(item);
    writeAnnouncements(list);
    console.log(`[公告] 发布: ${title}`);
    res.json({ code: 0, message: '发布成功', data: { announcement: item } });
  } else if (action === 'update') {
    const id = sanitizeText(req.body.id || '', 64);
    const list = readAnnouncements();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return res.status(404).json({ code: 404, message: '公告不存在' });
    if (req.body.title != null) list[idx].title = sanitizeText(req.body.title, 80);
    if (req.body.content != null) list[idx].content = sanitizeText(req.body.content, 1000);
    if (req.body.type != null && ANNOUNCEMENT_TYPES.includes(req.body.type)) list[idx].type = req.body.type;
    list[idx].updatedAt = Date.now();
    writeAnnouncements(list);
    console.log(`[公告] 更新: ${id}`);
    res.json({ code: 0, message: '更新成功', data: { announcement: list[idx] } });
  } else if (action === 'delete') {
    const id = sanitizeText(req.body.id || '', 64);
    const list = readAnnouncements();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) return res.status(404).json({ code: 404, message: '公告不存在' });
    list[idx].deletedAt = Date.now();
    writeAnnouncements(list);
    console.log(`[公告] 删除: ${id}`);
    res.json({ code: 0, message: '已删除' });
  } else {
    res.status(400).json({ code: 400, message: '未知 action' });
  }
});

// ============ 反馈 API（匿名） ============
const feedbackStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(FEEDBACK_DIR, 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    fs.mkdirSync(dir, { recursive: true });
    req.__fbDir = dir;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, sanitizeFilename(originalName));
  }
});
const feedbackUpload = multer({ storage: feedbackStorage, limits: { fileSize: 8 * 1024 * 1024 } });
app.post('/api/feedback', feedbackUpload.array('images', 5), (req, res) => {
  const content = sanitizeText(req.body.content || '', 300);
  const contact = sanitizeText(req.body.contact || '', 100);
  if (!content) return res.status(400).json({ code: 400, message: '反馈内容不能为空' });
  const dir = req.__fbDir;
  const meta = {
    content, contact,
    images: (req.files || []).map((f) => f.originalname),
    createdAt: Date.now()
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  console.log(`[反馈] 收到新反馈: ${content.slice(0, 30)}...`);
  res.json({ code: 0, message: '反馈已提交，感谢支持' });
});

// ============ 站点设置（只读公开） ============
app.get('/api/site-config', (req, res) => {
  res.json({
    code: 0,
    data: {
      adminEmail: ADMIN_EMAIL || '',
      userQuotaBytes: USER_QUOTA_BYTES,
      userQuotaFormatted: formatSize(USER_QUOTA_BYTES),
      allowRegister: true
    }
  });
});

// ============ 用户名安全校验 ============
// 规则：3-20 字符，字母/数字/下划线/中划线，首字符须字母或数字
function isValidUsername(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(name);
}
// 用户名转安全的目录名（防路径穿越）
function safeUserDirName(username) {
  return String(username || '').replace(/[^A-Za-z0-9_-]/g, '_');
}
// 每用户私密目录绝对路径
function userPrivateDir(username) {
  return path.join(USER_PRIVATE_ROOT, safeUserDirName(username));
}
// 递归计算目录总大小（字节）
function dirTotalSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const walk = (p) => {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'meta.json' || e.name === 'package.json') continue; // 元数据不计入配额
        const full = path.join(p, e.name);
        if (e.isFile()) {
          try { total += fs.statSync(full).size; } catch (err) {}
        } else if (e.isDirectory()) {
          if (e.name === '__bg__') continue; // 用户主页背景图不计入配额
          walk(full);
        }
      }
    };
    walk(dirPath);
  } catch (e) {}
  return total;
}
// 计算某用户已用空间
function userUsedBytes(username) {
  return dirTotalSize(userPrivateDir(username));
}

// ============ 认证 API ============

// 注册
app.post('/api/auth/register', (req, res) => {
  const username = sanitizeText(req.body.username, 20);
  const password = req.body.password || '';
  const email = sanitizeText(req.body.email, 100);
  if (!isValidUsername(username)) {
    return res.status(400).json({ code: 400, message: '用户名需 3-20 位，字母/数字/下划线/中划线，首字符须字母或数字' });
  }
  if (!password || password.length < 6 || password.length > 64) {
    return res.status(400).json({ code: 400, message: '密码长度需 6-64 位' });
  }
  // 邮箱可选，但若填了要校验
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
  }
  const existing = db.getUserByName(username);
  if (existing) {
    return res.status(409).json({ code: 409, message: '用户名已被占用' });
  }
  const userId = db.createUser(username, password, email || null);
  if (!userId) {
    return res.status(409).json({ code: 409, message: '用户名已被占用' });
  }
  // 创建该用户的私密目录
  try { fs.mkdirSync(userPrivateDir(username), { recursive: true }); } catch (e) {}
  // 自动登录：下发会话 cookie
  const token = db.createSession(userId, SESSION_TTL_MS);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
  console.log(`[注册] 新用户：${username} 邮箱:${email || '无'}`);
  res.json({
    code: 0,
    message: '注册成功',
    data: { id: userId, username: username, email: email || null }
  });
});

// 登录
app.post('/api/auth/login', (req, res) => {
  const username = sanitizeText(req.body.username, 20);
  const password = req.body.password || '';
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
  }
  const u = db.getUserByName(username);
  if (!u || !db.verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }
  const token = db.createSession(u.id, SESSION_TTL_MS);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
  console.log(`[登录] ${u.username}`);
  res.json({
    code: 0,
    message: '登录成功',
    data: { id: u.id, username: u.username, email: u.email }
  });
});

// 退出
app.post('/api/auth/logout', (req, res) => {
  if (req.sessionToken) db.deleteSession(req.sessionToken);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ code: 0, message: '已退出' });
});

// 当前登录用户信息
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.json({ code: 0, data: { user: null } });
  const used = userUsedBytes(req.user.username);
  res.json({
    code: 0,
    data: {
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        uploadLocked: req.user.uploadLocked,
        isAdmin: req.user.isAdmin,
        usedBytes: used,
        usedFormatted: formatSize(used),
        quotaBytes: USER_QUOTA_BYTES,
        quotaFormatted: formatSize(USER_QUOTA_BYTES)
      }
    }
  });
});

// 修改密码
app.post('/api/auth/change-password', requireLogin, (req, res) => {
  const oldPwd = req.body.oldPassword || '';
  const newPwd = req.body.newPassword || '';
  if (newPwd.length < 6 || newPwd.length > 64) {
    return res.status(400).json({ code: 400, message: '新密码长度需 6-64 位' });
  }
  const u = db.getUserById(req.user.id);
  if (!u || !db.verifyPassword(oldPwd, u.password_hash)) {
    return res.status(401).json({ code: 401, message: '原密码错误' });
  }
  db.changePassword(req.user.id, newPwd);
  // 改密后让其它会话失效（保留当前）
  db.deleteUserSessions(req.user.id);
  const token = db.createSession(req.user.id, SESSION_TTL_MS);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
  console.log(`[改密] ${req.user.username}`);
  res.json({ code: 0, message: '密码已修改' });
});

// 修改用户名
app.post('/api/auth/change-username', requireLogin, (req, res) => {
  const newUsername = sanitizeText(req.body.username, 20);
  if (!isValidUsername(newUsername)) {
    return res.status(400).json({ code: 400, message: '用户名需 3-20 位，字母/数字/下划线/中划线，首字符须字母或数字' });
  }
  if (newUsername.toLowerCase() === req.user.username.toLowerCase()) {
    return res.json({ code: 0, message: '用户名未变化' });
  }
  const ok = db.changeUsername(req.user.id, newUsername);
  if (!ok) return res.status(409).json({ code: 409, message: '用户名已被占用' });
  // 迁移用户私密目录到新用户名
  const oldDir = userPrivateDir(req.user.username);
  const newDir = userPrivateDir(newUsername);
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    try { fs.renameSync(oldDir, newDir); } catch (e) {}
  }
  console.log(`[改用户名] ${req.user.username} -> ${newUsername}`);
  res.json({ code: 0, message: '用户名已修改', data: { username: newUsername } });
});

// 注销账户
app.post('/api/auth/delete-account', requireLogin, (req, res) => {
  const pwd = req.body.password || '';
  const u = db.getUserById(req.user.id);
  if (!u || !db.verifyPassword(pwd, u.password_hash)) {
    return res.status(401).json({ code: 401, message: '密码错误，无法注销' });
  }
  // 删除该用户私密文件目录
  const dir = userPrivateDir(req.user.username);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  db.deleteUser(req.user.id);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  console.log(`[注销] ${req.user.username}`);
  res.json({ code: 0, message: '账户已注销' });
});

// ============ 用户搜索历史 ============
// 保存搜索历史（登录用户）
app.post('/api/user/search-history', requireLogin, (req, res) => {
  const kw = sanitizeText(req.body.keyword, 100);
  if (kw) db.addSearchHistory(req.user.id, kw);
  res.json({ code: 0 });
});
// 列出搜索历史
app.get('/api/user/search-history', requireLogin, (req, res) => {
  const list = db.listSearchHistory(req.user.id, 50);
  res.json({ code: 0, data: { history: list } });
});
// 清空搜索历史
app.post('/api/user/search-history/clear', requireLogin, (req, res) => {
  db.clearSearchHistory(req.user.id);
  res.json({ code: 0, message: '已清空' });
});

// ============ 用户私密文件列表（仅本人） ============
app.get('/api/user/private-files', requireLogin, (req, res) => {
  const dir = userPrivateDir(req.user.username);
  const files = [];
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue; // 用户私密只识别子目录结构
      const pkgEntries = listPackageEntries(fullPath);
      if (!pkgEntries.body) continue;
      const bodyPath = path.join(fullPath, pkgEntries.body);
      let stats;
      try { stats = fs.statSync(bodyPath); } catch (e) { continue; }
      const meta = readPackageMeta(fullPath);
      const parsed = parseFilename(pkgEntries.body);
      files.push({
        name: pkgEntries.body,
        dirname: entry.name,
        chineseName: meta.description || parsed.chineseName,
        description: meta.description || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        version: parsed.version,
        extension: parsed.extension,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        modified: stats.mtimeMs,
        modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN'),
        downloadUrl: `/download-user/${encodeURIComponent(entry.name)}`,
        previewUrl: `#preview-user/${encodeURIComponent(entry.name)}`
      });
    }
  }
  files.sort((a, b) => b.modified - a.modified);
  const used = userUsedBytes(req.user.username);
  res.json({
    code: 0,
    data: {
      total: files.length,
      files,
      usedBytes: used,
      usedFormatted: formatSize(used),
      quotaBytes: USER_QUOTA_BYTES,
      quotaFormatted: formatSize(USER_QUOTA_BYTES),
      uploadLocked: req.user.uploadLocked
    }
  });
});

// 用户私密文件下载（仅本人）—— 多重鉴权：1) 必登录 2) 目录必须在本人命名空间下 3) meta.owner 必须是本人
app.get('/download-user/:dirname', requireLogin, (req, res) => {
  const dirname = req.params.dirname;
  if (dirname.includes('..') || dirname.includes('/') || dirname.includes('\\')) {
    return res.status(400).send('非法的目录名');
  }
  // 二次鉴权：路径必须在本人用户目录下（防越权）
  const userDir = userPrivateDir(req.user.username);
  const dirPath = path.join(userDir, dirname);
  const resolved = path.resolve(dirPath);
  if (!resolved.startsWith(userDir + path.sep) && resolved !== userDir) {
    return res.status(403).send('无权访问此文件');
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(404).send('文件不存在');
  }
  // 三次鉴权：读 meta.owner 二次校验
  const meta = readPackageMeta(dirPath);
  if (meta.owner && meta.owner !== req.user.username && !req.user.isAdmin) {
    return res.status(403).send('无权访问此文件');
  }
  const bodyPath = getPackageBodyPath(dirPath);
  if (!bodyPath) return res.status(404).send('文件不存在');
  streamFileDownload(req, res, bodyPath, path.basename(bodyPath));
});

// 用户私密文件预览（仅本人）—— 同样的三重鉴权
app.get('/api/preview-user/:dirname', requireLogin, (req, res) => {
  const dirname = req.params.dirname;
  if (dirname.includes('..') || dirname.includes('/') || dirname.includes('\\')) {
    return res.status(400).json({ code: 400, message: '非法的目录名' });
  }
  const userDir = userPrivateDir(req.user.username);
  const dirPath = path.join(userDir, dirname);
  const resolved = path.resolve(dirPath);
  if (!resolved.startsWith(userDir + path.sep) && resolved !== userDir) {
    return res.status(403).json({ code: 403, message: '无权访问此文件' });
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(404).json({ code: 404, message: '文件包不存在' });
  }
  const meta = readPackageMeta(dirPath);
  if (meta.owner && meta.owner !== req.user.username && !req.user.isAdmin) {
    return res.status(403).json({ code: 403, message: '无权访问此文件' });
  }
  const pkgEntries = listPackageEntries(dirPath);
  if (!pkgEntries.body) return res.status(404).json({ code: 404, message: '包内未找到本体文件' });
  const bodyPath = path.join(dirPath, pkgEntries.body);
  const bodyStats = fs.statSync(bodyPath);
  const parsed = parseFilename(pkgEntries.body);
  const others = (pkgEntries.others || []).map((n) => {
    const isDir = n.endsWith('/');
    const cleanName = isDir ? n.slice(0, -1) : n;
    let size = 0;
    try { size = fs.statSync(path.join(dirPath, cleanName)).size; } catch (e) {}
    return { name: n, size, isDir };
  });
  let archiveEntries = null;
  if (isArchive(pkgEntries.body)) archiveEntries = listArchiveEntries(bodyPath);
  res.json({
    code: 0,
    data: {
      dirname,
      isHidden: false,
      body: {
        name: pkgEntries.body,
        extension: parsed.extension,
        size: bodyStats.size,
        sizeFormatted: formatSize(bodyStats.size),
        modified: bodyStats.mtimeMs,
        modifiedFormatted: new Date(bodyStats.mtimeMs).toLocaleString('zh-CN'),
        cover: coverTypeForExt(parsed.extension),
        isArchive: isArchive(pkgEntries.body)
      },
      title: meta.description || parsed.chineseName,
      description: meta.description || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      docContent: readPackageDescription(dirPath),
      docName: pkgEntries.description || '',
      entries: others,
      archiveEntries,
      downloadUrl: `/download-user/${encodeURIComponent(dirname)}`
    }
  });
});

// ============ 用户主页背景图（保存至用户私密子目录，不计配额） ============
const BG_DIR_NAME = '__bg__';
const BG_ALLOWED_EXT = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.gif': 1, '.webp': 1 };
const BG_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const bgStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(userPrivateDir(req.user.username), BG_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'bg' + (BG_ALLOWED_EXT[ext] ? ext : '.png'));
  }
});
const bgUpload = multer({
  storage: bgStorage,
  limits: { fileSize: BG_MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!BG_ALLOWED_EXT[ext]) return cb(new Error('仅支持 jpg/png/gif/webp 格式'));
    cb(null, true);
  }
});

// ============ 用户头像 ============
const AVATAR_DIR = path.join(__dirname, 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
const AVATAR_ALLOWED_EXT = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.gif': 1, '.webp': 1 };
const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2MB

// 头像文件名 = 用户名 + 原扩展名
function avatarPath(username) {
  // 用户名已在校验时保证安全（字母数字下划线中划线），此处直接拼接
  return path.join(AVATAR_DIR, username + '.jpg');
}

// 上传/更新头像
app.post('/api/user/avatar', requireLogin, (req, res) => {
  const avatarUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, AVATAR_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, req.user.username + ext);
      }
    }),
    limits: { fileSize: AVATAR_MAX_SIZE },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!AVATAR_ALLOWED_EXT[ext]) return cb(new Error('仅支持 jpg/png/gif/webp 格式'));
      cb(null, true);
    }
  }).single('avatar');

  avatarUpload(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, message: err.message || '头像上传失败' });
    if (!req.file) return res.status(400).json({ code: 400, message: '未收到头像文件' });
    res.json({ code: 0, message: '头像更新成功', data: { url: '/api/avatar/' + encodeURIComponent(req.user.username) + '?t=' + Date.now() } });
  });
});

// 获取头像（公开，未登录也能看到，用文件名直接命中）
app.get('/api/avatar/:username', (req, res) => {
  const username = req.params.username;
  if (!username || !/^[A-Za-z0-9_-]+$/.test(username)) {
    return res.status(404).send('Not found');
  }
  // 尝试常见扩展名
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  for (const ext of exts) {
    const p = path.join(AVATAR_DIR, username + ext);
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }
  res.status(404).send('Not found');
});

// 删除头像
app.delete('/api/user/avatar', requireLogin, (req, res) => {
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  for (const ext of exts) {
    const p = path.join(AVATAR_DIR, req.user.username + ext);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  }
  res.json({ code: 0, message: '头像已删除' });
});

// 背景图信息（用于前端判断是否有图 + 缓存破坏）
app.get('/api/user/bg-image/info', requireLogin, (req, res) => {
  const dir = path.join(userPrivateDir(req.user.username), BG_DIR_NAME);
  const found = findBgFile(dir);
  if (!found) return res.json({ code: 0, data: { hasImage: false } });
  let mtime = 0;
  try { mtime = fs.statSync(found.fullPath).mtimeMs; } catch (e) {}
  res.json({
    code: 0,
    data: {
      hasImage: true,
      url: `/api/user/bg-image?t=${mtime}`,
      updatedAt: mtime
    }
  });
});

// 获取背景图文件流（仅本人）
app.get('/api/user/bg-image', requireLogin, (req, res) => {
  const dir = path.join(userPrivateDir(req.user.username), BG_DIR_NAME);
  const found = findBgFile(dir);
  if (!found) return res.status(404).json({ code: 404, message: '未设置背景图' });
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', found.mime);
  fs.createReadStream(found.fullPath).pipe(res);
});

// 上传/替换背景图
app.post('/api/user/bg-image', requireLogin, (req, res) => {
  bgUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ code: 400, message: err.message || '上传失败' });
    }
    if (!req.file) return res.status(400).json({ code: 400, message: '未收到图片文件' });
    const dir = path.join(userPrivateDir(req.user.username), BG_DIR_NAME);
    // 删除其它格式的旧背景图（只保留刚上传的）
    try {
      for (const ext of Object.keys(BG_ALLOWED_EXT)) {
        if (ext !== path.extname(req.file.filename).toLowerCase()) {
          const old = path.join(dir, 'bg' + ext);
          if (fs.existsSync(old) && old !== req.file.path) fs.unlinkSync(old);
        }
      }
    } catch (e) {}
    let mtime = 0;
    try { mtime = fs.statSync(req.file.path).mtimeMs; } catch (e) {}
    res.json({
      code: 0,
      message: '背景图已更新',
      data: { url: `/api/user/bg-image?t=${mtime}`, updatedAt: mtime }
    });
  });
});

// 删除背景图
app.delete('/api/user/bg-image', requireLogin, (req, res) => {
  const dir = path.join(userPrivateDir(req.user.username), BG_DIR_NAME);
  const found = findBgFile(dir);
  if (!found) return res.json({ code: 0, message: '本就无背景图' });
  try { fs.unlinkSync(found.fullPath); } catch (e) {}
  res.json({ code: 0, message: '已删除背景图' });
});

// 查找背景图目录内的图片文件
function findBgFile(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  try {
    for (const ext of Object.keys(BG_ALLOWED_EXT)) {
      const fullPath = path.join(dir, 'bg' + ext);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return { fullPath, ext, mime: mimeMap[ext] || 'application/octet-stream' };
      }
    }
  } catch (e) {}
  return null;
}

// ============ 管理员：用户列表 ============
app.get('/api/admin/users', checkAdmin, (req, res) => {
  const users = db.listUsers();
  const list = users.map((u) => {
    const used = userUsedBytes(u.username);
    return {
      id: u.id,
      username: u.username,
      email: u.email || '',
      uploadLocked: !!u.upload_locked,
      isAdmin: !!u.is_admin,
      createdAt: u.created_at,
      createdAtFormatted: new Date(u.created_at).toLocaleString('zh-CN'),
      usedBytes: used,
      usedFormatted: formatSize(used),
      quotaBytes: USER_QUOTA_BYTES,
      quotaFormatted: formatSize(USER_QUOTA_BYTES),
      usagePercent: USER_QUOTA_BYTES > 0 ? Math.min(100, Math.round((used / USER_QUOTA_BYTES) * 10000) / 100) : 0
    };
  });
  res.json({ code: 0, data: { total: list.length, users: list } });
});

// 管理员：解锁用户上传通道
app.post('/api/admin/unlock-user', checkAdmin, express.json(), (req, res) => {
  const userId = parseInt(req.body.userId, 10);
  if (!userId) return res.status(400).json({ code: 400, message: '缺少 userId' });
  const u = db.getUserById(userId);
  if (!u) return res.status(404).json({ code: 404, message: '用户不存在' });
  db.setUploadLocked(userId, false);
  console.log(`[管理员] 解锁用户上传通道：${u.username}`);
  res.json({ code: 0, message: '已解锁' });
});

// ============ 邮件停机通知（nodemailer，懒加载） ============
// SMTP 配置（环境变量）
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false'; // 默认 true（465）
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let _transporter = null;
function getMailer() {
  if (_transporter) return _transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (e) { return null; }
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return _transporter;
}

// 通知信息：SMTP 是否可用 + 收件人数量
app.get('/api/admin/notify/info', checkAdmin, (req, res) => {
  const mailer = getMailer();
  const users = db.listUsers().filter((u) => u.email);
  res.json({
    code: 0,
    data: {
      smtpReady: !!mailer,
      from: SMTP_FROM || '',
      recipientCount: users.length
    }
  });
});

// 发送停机通知邮件
app.post('/api/admin/notify', checkAdmin, express.json(), (req, res) => {
  const mailer = getMailer();
  if (!mailer) {
    return res.status(500).json({ code: 500, message: 'SMTP 未配置，请设置 SMTP_HOST/SMTP_USER/SMTP_PASS 环境变量并安装 nodemailer' });
  }
  const subject = sanitizeText(req.body.subject, 100);
  const text = sanitizeText(req.body.text, 2000);
  if (!subject || !text) {
    return res.status(400).json({ code: 400, message: '主题和正文不能为空' });
  }
  const users = db.listUsers().filter((u) => u.email);
  if (!users.length) {
    return res.status(400).json({ code: 400, message: '没有用户填写邮箱，无法发送' });
  }
  const recipients = users.map((u) => u.email).join(', ');
  const fullText = text + '\n\n—— 文件下载站 管理员';
  mailer.sendMail({
    from: SMTP_FROM,
    to: SMTP_FROM, // 发给自己，密送收件人，避免泄露其他用户邮箱
    bcc: recipients,
    subject: '[文件下载站通知] ' + subject,
    text: fullText
  }, (err, info) => {
    if (err) {
      console.error('[邮件] 发送失败：', err.message);
      return res.status(500).json({ code: 500, message: '发送失败：' + err.message });
    }
    console.log(`[邮件] 停机通知已发送至 ${users.length} 位用户，主题：${subject}`);
    res.json({ code: 0, message: `已发送至 ${users.length} 位用户`, data: { recipientCount: users.length } });
  });
});

// ============ 启动 ============
app.listen(PORT, HOST, () => {
  console.log('');
  console.log('========================================');
  console.log('   文件下载站 已启动');
  console.log('========================================');
  console.log(`  监听地址  : http://${HOST}:${PORT}`);
  console.log(`  下载目录  : ${FILES_DIR}`);
  console.log(`  私密目录  : ${PRIVATE_FILES_DIR}`);
  console.log(`  待审目录  : ${PENDING_DIR}`);
  console.log(`  审核密码  : ${ADMIN_PASSWORD}${ADMIN_PASSWORD === 'admin123' ? '  ⚠️ 建议修改环境变量 ADMIN_PASSWORD' : ''}`);
  console.log(`  审核入口  : 点击左上角 Logo 图标 7 次（间隔 ≥ 0.5 秒）`);
  console.log('');
  console.log('  【功能更新】');
  console.log('  · 支持用户上传（带型号/描述，100字限制）');
  console.log('  · 上传可选「公开」或「仅管理员可见」');
  console.log('  · 仅管理员可见的文件不在公开列表显示，管理员后台可查看并复制直链');
  console.log('  · 私密文件名中文自动转拼音');
  console.log('  · 建议大小 2GB（提醒用，不做硬性拦截）');
  console.log('========================================');
  console.log('');
});
