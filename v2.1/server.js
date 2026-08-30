const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pinyin } = require('pinyin-pro');

const app = express();

// ============ 配置区（可按需修改） ============
const PORT = process.env.PORT || 8080;
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, 'files');
const PRIVATE_FILES_DIR = process.env.PRIVATE_FILES_DIR || path.join(__dirname, 'files-private');
const PENDING_DIR = process.env.PENDING_DIR || path.join(__dirname, 'pending');
const HOST = process.env.HOST || '0.0.0.0';
const CHUNK_SIZE = 1024 * 1024; // 1MB
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // 审核密码，建议改复杂点
// 危险字符正则：只过滤真正用于注入攻击的字符（< > " ' ` | & ; \ 及控制字符）
// 保留 () - _ * # @ ! ~ ^ $ {} [] 等正常描述用字符
const UNSAFE_CHAR_REGEX = /[<>"'`|&;\\\x00-\x1f]/g;
const MAX_DESC_LENGTH = 100;
const SUGGEST_MAX_SIZE = 2 * 1024 * 1024 * 1024; // 建议最大 2GB（只提醒，不强制）
// ==============================================

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

// JSON body 中间件
app.use(express.json({ limit: '10mb' }));

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

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

// ============ 通用文件列表 API ============
app.get('/api/files', (req, res) => {
  try {
    const entries = fs.readdirSync(FILES_DIR, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.meta.json')) continue;
      const fullPath = path.join(FILES_DIR, entry.name);
      const stats = fs.statSync(fullPath);
      if (!entry.isFile()) continue;
      const parsed = parseFilename(entry.name);
      const metaPath = path.join(FILES_DIR, `${entry.name}.meta.json`);
      let description = '';
      try {
        if (fs.existsSync(metaPath)) description = JSON.parse(fs.readFileSync(metaPath, 'utf8')).description || '';
      } catch (e) {}
      files.push({
        name: entry.name,
        chineseName: description || parsed.chineseName, // 有描述优先用描述
        version: parsed.version,
        extension: parsed.extension,
        description: description,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        modified: stats.mtimeMs,
        modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN')
      });
    }
    files.sort((a, b) => b.modified - a.modified);
    res.json({ code: 0, message: 'success', data: { total: files.length, files } });
  } catch (err) {
    console.error('[错误] 读取文件列表失败:', err);
    res.status(500).json({ code: 500, message: '读取文件列表失败: ' + err.message });
  }
});

// ============ 下载 ============
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('非法的文件名');
  }
  const filePath = path.join(FILES_DIR, filename);
  const privatePath = path.join(PRIVATE_FILES_DIR, filename);
  // 先查公开目录，再查私密目录
  let actualPath = null;
  if (fs.existsSync(filePath)) actualPath = filePath;
  else if (fs.existsSync(privatePath)) actualPath = privatePath;
  if (!actualPath) return res.status(404).send('文件不存在');
  const stats = fs.statSync(actualPath);
  if (!stats.isFile()) return res.status(400).send('不是有效的文件');
  const fileSize = stats.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
    stream.on('error', (err) => { console.error('[下载错误]', filename, err.message); res.end(); });
    stream.pipe(res);
    console.log(`[断点续传] ${filename} 范围: ${start}-${end}/${fileSize}`);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'application/octet-stream' });
    const stream = fs.createReadStream(actualPath, { highWaterMark: CHUNK_SIZE });
    stream.on('error', (err) => { console.error('[下载错误]', filename, err.message); res.end(); });
    stream.pipe(res);
    console.log(`[开始下载] ${filename} 大小: ${formatSize(fileSize)}`);
  }
});

// ============ 上传 API ============
const uploadFields = upload.single('file');

app.post('/api/upload', (req, res) => {
  uploadFields(req, res, (err) => {
    if (err) {
      console.error('[上传错误]', err);
      return res.status(500).json({ code: 500, message: '上传失败: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ code: 400, message: '没有接收到文件' });

    // 处理描述和型号
    const description = sanitizeText(req.body.description || req.body.model || '', MAX_DESC_LENGTH);
    const visibility = (req.body.visibility === 'private') ? 'private' : 'public';
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const meta = {
      description: description,
      originalName: originalName,
      visibility: visibility,
      uploadedAt: Date.now(),
      size: req.file.size,
      sizeFormatted: formatSize(req.file.size),
      overSuggested: req.file.size > SUGGEST_MAX_SIZE
    };
    writeMeta(req.file.filename, meta);

    console.log(`[上传] ${req.file.filename} ${meta.sizeFormatted} 描述:${description}`);

    res.json({
      code: 0,
      message: '上传成功，待审核后会显示在下载列表中',
      data: {
        filename: req.file.filename,
        size: req.file.size,
        sizeFormatted: meta.sizeFormatted,
        description: description,
        overSuggested: meta.overSuggested,
        pendingMessage: '文件已上传，等待管理员审核通过'
      }
    });
  });
});

// 上传配置（给前端显示提醒信息）
app.get('/api/upload-config', (req, res) => {
  res.json({
    code: 0,
    data: {
      suggestMaxSize: SUGGEST_MAX_SIZE,
      suggestMaxSizeFormatted: formatSize(SUGGEST_MAX_SIZE),
      maxDescLength: MAX_DESC_LENGTH,
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
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.meta.json')) continue;
      const fullPath = path.join(PENDING_DIR, entry.name);
      if (!fs.statSync(fullPath).isFile()) continue;
      const meta = readMeta(entry.name);
      const stats = fs.statSync(fullPath);
      files.push({
        name: entry.name,
        description: meta.description || '',
        originalName: meta.originalName || entry.name,
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

// 审核通过：移动到 files 目录
app.post('/api/admin/approve', checkAdmin, express.json(), (req, res) => {
  const filename = sanitizeFilename(req.body && req.body.filename);
  if (!filename) return res.status(400).json({ code: 400, message: '缺少文件名' });

  const src = path.join(PENDING_DIR, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ code: 404, message: '待审核文件不存在' });

  const meta = readMeta(filename);
  const visibility = meta.visibility === 'private' ? 'private' : 'public';

  // 私密文件：文件名中文转拼音，URL 更干净
  let destName = filename;
  if (visibility === 'private') {
    destName = toPinyinFilename(filename);
  }
  // 公开文件移到 FILES_DIR，私密文件移到 PRIVATE_FILES_DIR
  const targetDir = visibility === 'private' ? PRIVATE_FILES_DIR : FILES_DIR;
  destName = uniqueName(targetDir, destName);
  const dest = path.join(targetDir, destName);

  try {
    fs.renameSync(src, dest);
    // 把描述也移动过去
    const desc = sanitizeText(meta.description || '', MAX_DESC_LENGTH);
    fs.writeFileSync(path.join(targetDir, `${destName}.meta.json`), JSON.stringify({ description: desc }, null, 2), 'utf8');
    // 删除旧的元数据文件
    const oldMeta = path.join(PENDING_DIR, `${filename}.meta.json`);
    if (fs.existsSync(oldMeta)) fs.unlinkSync(oldMeta);
    console.log(`[审核通过] ${filename} → ${destName} → ${targetDir} 描述:${desc} 可见性:${visibility}`);
    res.json({ code: 0, message: visibility === 'private' ? '审核通过，文件已加入私密文件列表' : '审核通过，文件已加入下载列表' });
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
      if (!stats.isFile()) continue;
      const metaPath = path.join(PRIVATE_FILES_DIR, `${entry.name}.meta.json`);
      let description = '';
      try {
        if (fs.existsSync(metaPath)) description = JSON.parse(fs.readFileSync(metaPath, 'utf8')).description || '';
      } catch (e) {}
      const parsed = parseFilename(entry.name);
      files.push({
        name: entry.name,
        chineseName: description || parsed.chineseName,
        description: description,
        version: parsed.version,
        extension: parsed.extension,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        modified: stats.mtimeMs,
        modifiedFormatted: new Date(stats.mtimeMs).toLocaleString('zh-CN'),
        downloadUrl: `/download/${encodeURIComponent(entry.name)}`
      });
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
      if (!e.name.startsWith('.') && !e.name.endsWith('.meta.json') && e.isFile()) count++;
    }
    res.json({ code: 0, data: { pendingCount: count } });
  } catch (e) { res.json({ code: 0, data: { pendingCount: 0 } }); }
});

// ============ 健康检查 ============
app.get('/api/health', (req, res) => {
  res.json({ code: 0, status: 'ok', timestamp: Date.now() });
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
