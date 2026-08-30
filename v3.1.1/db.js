// ============================================================
// SQLite 数据访问层（第 2 期：用户/会话/搜索历史）
// 使用 better-sqlite3（同步 API，单文件数据库 data/app.db）
// ============================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[DB] better-sqlite3 未安装，请先运行：npm install better-sqlite3');
  throw e;
}

// 数据库文件路径
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // 写并发友好
db.pragma('foreign_keys = ON');

// ============ 建表 ============
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT,
    salt          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    upload_locked INTEGER NOT NULL DEFAULT 0,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT 0,
    expires_at  INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS search_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    keyword    TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_history_time ON search_history(created_at);

  -- 分片上传会话（断点续传 + 秒传）
  CREATE TABLE IF NOT EXISTS upload_sessions (
    upload_id      TEXT PRIMARY KEY,           -- 前端生成的 UUID
    file_md5       TEXT NOT NULL,              -- 整个文件的 MD5
    file_name      TEXT NOT NULL,              -- 原始文件名
    file_size      INTEGER NOT NULL,           -- 文件总大小（字节）
    chunk_size     INTEGER NOT NULL,           -- 每片大小
    total_chunks   INTEGER NOT NULL,           -- 总片数
    uploaded_chunks TEXT NOT NULL DEFAULT '[]',-- JSON 数组，已上传的片索引
    visibility     TEXT NOT NULL DEFAULT 'public', -- public/private/hidden/user-private
    user_id        INTEGER,                    -- user-private 时记录归属
    username       TEXT,                       -- 同上
    description    TEXT,
    tags           TEXT,                       -- JSON 数组
    status         TEXT NOT NULL DEFAULT 'uploading', -- uploading/merging/completed/failed/expired
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    completed_at   INTEGER,
    target_dir     TEXT                        -- 合并后的目标子目录绝对路径
  );
  CREATE INDEX IF NOT EXISTS idx_upload_user ON upload_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_upload_md5  ON upload_sessions(file_md5);
  CREATE INDEX IF NOT EXISTS idx_upload_status ON upload_sessions(status);

  -- 秒传表：用 SHA-256 + 文件大小 联合作为指纹（避免哈希碰撞覆盖已有文件）
  -- 注：字段名保留 file_md5 不变（向后兼容），实际存的是 SHA-256
  CREATE TABLE IF NOT EXISTS file_fingerprints (
    file_md5   TEXT NOT NULL,              -- 实际为 SHA-256
    file_size  INTEGER NOT NULL,
    file_name  TEXT NOT NULL,
    target_dir TEXT NOT NULL,
    visibility TEXT NOT NULL,
    user_id    INTEGER,
    username   TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (file_md5, file_size)
  );
  CREATE INDEX IF NOT EXISTS idx_fp_user ON file_fingerprints(user_id);
`);

// ============ 兼容老库：补列（已存在则跳过） ============
try {
  db.exec(`ALTER TABLE file_fingerprints ADD COLUMN file_size INTEGER`);
  console.log('[DB] file_fingerprints.file_size 列已补充');
} catch (e) { /* 列已存在，忽略 */ }

// upload_sessions 增加 desc_text 列（v3.0：文件说明文本，替代旧的说明文档上传）
try {
  db.exec(`ALTER TABLE upload_sessions ADD COLUMN desc_text TEXT`);
  console.log('[DB] upload_sessions.desc_text 列已补充');
} catch (e) { /* 列已存在，忽略 */ }

// ============ 密码哈希（scrypt） ============
// 格式：scrypt$N$r$p$saltHex$hashHex
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  const hash = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
  // 定时安全比较
  return crypto.timingSafeEqual(hash, expected);
}

// ============ 会话 token 生成 ============
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============ 用户 CRUD ============
const stmts = {
  insertUser: db.prepare(`INSERT INTO users (username, email, salt, password_hash, created_at)
                          VALUES (@username, @email, @salt, @password_hash, @created_at)`),
  getUserByName: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updatePassword: db.prepare(`UPDATE users SET salt = ?, password_hash = ? WHERE id = ?`),
  updateUsername: db.prepare(`UPDATE users SET username = ? WHERE id = ?`),
  updateEmail: db.prepare(`UPDATE users SET email = ? WHERE id = ?`),
  setUploadLocked: db.prepare(`UPDATE users SET upload_locked = ? WHERE id = ?`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),
  listUsers: db.prepare(`SELECT id, username, email, upload_locked, is_admin, created_at FROM users ORDER BY created_at ASC`),

  insertSession: db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`),
  getSession: db.prepare(`SELECT * FROM sessions WHERE token = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  deleteUserSessions: db.prepare(`DELETE FROM sessions WHERE user_id = ?`),
  cleanExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < ?`),

  insertHistory: db.prepare(`INSERT INTO search_history (user_id, keyword, created_at) VALUES (?, ?, ?)`),
  listHistory: db.prepare(`SELECT id, keyword, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`),
  clearHistory: db.prepare(`DELETE FROM search_history WHERE user_id = ?`),

  // 分片上传会话
  insertUploadSession: db.prepare(`INSERT INTO upload_sessions
    (upload_id, file_md5, file_name, file_size, chunk_size, total_chunks, uploaded_chunks,
     visibility, user_id, username, description, tags, desc_text, status, created_at, updated_at)
    VALUES (@upload_id, @file_md5, @file_name, @file_size, @chunk_size, @total_chunks, @uploaded_chunks,
     @visibility, @user_id, @username, @description, @tags, @desc_text, @status, @created_at, @updated_at)`),
  getUploadSession: db.prepare(`SELECT * FROM upload_sessions WHERE upload_id = ?`),
  getUploadSessionByMd5User: db.prepare(`SELECT * FROM upload_sessions WHERE file_md5 = ? AND user_id IS ? AND status != 'expired' ORDER BY created_at DESC LIMIT 1`),
  updateUploadChunks: db.prepare(`UPDATE upload_sessions SET uploaded_chunks = ?, updated_at = ? WHERE upload_id = ?`),
  updateUploadStatus: db.prepare(`UPDATE upload_sessions SET status = ?, updated_at = ?, completed_at = ?, target_dir = ? WHERE upload_id = ?`),
  deleteUploadSession: db.prepare(`DELETE FROM upload_sessions WHERE upload_id = ?`),
  listExpiredUploads: db.prepare(`SELECT upload_id FROM upload_sessions WHERE updated_at < ? AND status = 'uploading'`),
  // 秒传指纹（联合主键：file_md5 + file_size）
  insertFingerprint: db.prepare(`INSERT OR REPLACE INTO file_fingerprints
    (file_md5, file_size, file_name, target_dir, visibility, user_id, username, created_at)
    VALUES (@file_md5, @file_size, @file_name, @target_dir, @visibility, @user_id, @username, @created_at)`),
  getFingerprint: db.prepare(`SELECT * FROM file_fingerprints WHERE file_md5 = ? AND file_size = ?`),
  getFingerprintForUser: db.prepare(`SELECT * FROM file_fingerprints WHERE file_md5 = ? AND file_size = ? AND (visibility != 'user-private' OR user_id = ?)`),
  deleteFingerprintByDir: db.prepare(`DELETE FROM file_fingerprints WHERE target_dir = ?`),

  // 分片上传：批量写已上传分片
  setUploadChunks: db.prepare(`UPDATE upload_sessions SET uploaded_chunks = ?, updated_at = ? WHERE upload_id = ?`)
};

// ============ 内存缓存层：分片进度不每片写 DB ============
// uploadId → { chunks: Set<index>, dirty: bool, lastFlush: number }
const chunkMemCache = new Map();

// ============ 导出 API ============
module.exports = {
  db,

  // 密码
  hashPassword,
  verifyPassword,

  // 会话
  generateToken,
  createSession(userId, ttlMs) {
    const now = Date.now();
    const token = generateToken();
    stmts.insertSession.run(token, userId, now, now + ttlMs);
    return token;
  },
  getSessionRow(token) {
    return stmts.getSession.get(token);
  },
  deleteSession(token) {
    stmts.deleteSession.run(token);
  },
  deleteUserSessions(userId) {
    stmts.deleteUserSessions.run(userId);
  },
  cleanExpiredSessions() {
    stmts.cleanExpiredSessions.run(Date.now());
  },

  // 用户
  createUser(username, password, email) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password);
    try {
      const info = stmts.insertUser.run({
        username: username,
        email: email || null,
        salt: salt,
        password_hash: passwordHash,
        created_at: Date.now()
      });
      return info.lastInsertRowid;
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) return null; // 用户名重复
      throw e;
    }
  },
  getUserByName(username) {
    return stmts.getUserByName.get(username);
  },
  getUserById(id) {
    return stmts.getUserById.get(id);
  },
  changePassword(userId, newPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(newPassword);
    stmts.updatePassword.run(salt, passwordHash, userId);
  },
  changeUsername(userId, newUsername) {
    try {
      stmts.updateUsername.run(newUsername, userId);
      return true;
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) return false;
      throw e;
    }
  },
  updateEmail(userId, email) {
    stmts.updateEmail.run(email || null, userId);
  },
  setUploadLocked(userId, locked) {
    stmts.setUploadLocked.run(locked ? 1 : 0, userId);
  },
  deleteUser(userId) {
    stmts.deleteUser.run(userId);
  },
  listUsers() {
    return stmts.listUsers.all();
  },

  // 搜索历史
  addSearchHistory(userId, keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return;
    // 单用户最多保留 100 条，超出删最旧
    stmts.insertHistory.run(userId, kw.slice(0, 100), Date.now());
    db.exec(`DELETE FROM search_history WHERE user_id = ${parseInt(userId, 10)}
             AND id NOT IN (SELECT id FROM search_history WHERE user_id = ${parseInt(userId, 10)}
                            ORDER BY created_at DESC LIMIT 100)`);
  },
  listSearchHistory(userId, limit) {
    return stmts.listHistory.all(userId, limit || 50);
  },
  clearSearchHistory(userId) {
    stmts.clearHistory.run(userId);
  },

  // 分片上传会话
  createUploadSession(s) {
    const now = Date.now();
    stmts.insertUploadSession.run({
      upload_id: s.uploadId,
      file_md5: s.fileMd5,
      file_name: s.fileName,
      file_size: s.fileSize,
      chunk_size: s.chunkSize,
      total_chunks: s.totalChunks,
      uploaded_chunks: '[]',
      visibility: s.visibility || 'public',
      user_id: s.userId || null,
      username: s.username || null,
      description: s.description || '',
      tags: s.tags || '[]',
      desc_text: s.descText || '',
      status: 'uploading',
      created_at: now,
      updated_at: now
    });
  },
  getUploadSession(uploadId) {
    return stmts.getUploadSession.get(uploadId);
  },
  getUploadSessionByMd5(fileMd5, userId) {
    return stmts.getUploadSessionByMd5User.get(fileMd5, userId || null);
  },
  markChunkUploaded(uploadId, chunkIndex) {
    // 内存缓存层：避免每片都写 DB（4 并发×N 用户场景下写锁会成瓶颈）
    // 改为：内存 Set 累积，每 5 片或外部显式 flush 时批量写一次 DB
    if (!chunkMemCache.has(uploadId)) {
      // 首次调用：从 DB 加载到内存
      const row = stmts.getUploadSession.get(uploadId);
      let arr = [];
      try { arr = JSON.parse(row.uploaded_chunks || '[]'); } catch (e) { arr = []; }
      chunkMemCache.set(uploadId, { chunks: new Set(arr), dirty: false, lastFlush: Date.now() });
    }
    const cache = chunkMemCache.get(uploadId);
    cache.chunks.add(chunkIndex);
    cache.dirty = true;
    // 批量写策略：累积 5 片或距上次写超过 10 秒
    const now = Date.now();
    if (cache.chunks.size % 5 === 0 || now - cache.lastFlush > 10000) {
      this.flushChunks(uploadId);
    }
    return Array.from(cache.chunks).sort((a, b) => a - b);
  },
  // 显式把内存中的已上传分片刷盘到 DB（merge 之前必调）
  flushChunks(uploadId) {
    const cache = chunkMemCache.get(uploadId);
    if (!cache || !cache.dirty) return;
    const arr = Array.from(cache.chunks).sort((a, b) => a - b);
    stmts.setUploadChunks.run(JSON.stringify(arr), Date.now(), uploadId);
    cache.dirty = false;
    cache.lastFlush = Date.now();
  },
  // 重置内存缓存（init 时反查文件系统重建用）
  resetChunkCache(uploadId, chunkArr) {
    chunkMemCache.set(uploadId, {
      chunks: new Set(chunkArr || []),
      dirty: false,
      lastFlush: Date.now()
    });
  },
  clearChunkCache(uploadId) {
    chunkMemCache.delete(uploadId);
  },
  setUploadStatus(uploadId, status, targetDir) {
    const now = Date.now();
    stmts.updateUploadStatus.run(status, now, status === 'completed' ? now : null, targetDir || null, uploadId);
  },
  deleteUploadSession(uploadId) {
    stmts.deleteUploadSession.run(uploadId);
  },
  cleanExpiredUploads(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    const expired = stmts.listExpiredUploads.all(cutoff);
    return expired;
  },

  // 秒传指纹
  addFingerprint(fp) {
    stmts.insertFingerprint.run({
      file_md5: fp.fileMd5,
      file_size: fp.fileSize,
      file_name: fp.fileName,
      target_dir: fp.targetDir,
      visibility: fp.visibility,
      user_id: fp.userId || null,
      username: fp.username || null,
      created_at: Date.now()
    });
  },
  getFingerprintForUser(fileMd5, fileSize, userId) {
    return stmts.getFingerprintForUser.get(fileMd5, fileSize, userId || 0);
  },
  deleteFingerprintByDir(targetDir) {
    stmts.deleteFingerprintByDir.run(targetDir);
  }
};
