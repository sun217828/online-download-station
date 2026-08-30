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
`);

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
  clearHistory: db.prepare(`DELETE FROM search_history WHERE user_id = ?`)
};

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
  }
};
