(function () {
  'use strict';

  // ====== DOM 元素 ======
  const $ = (id) => document.getElementById(id);

  const fileTableBody = $('fileTableBody');
  const fileCountBadge = $('fileCount');
  const searchInput = $('searchInput');
  const refreshBtn = $('refreshBtn');
  const emptyState = $('emptyState');
  const noResultState = $('noResultState');

  const pendingBadge = $('pendingBadge');

  // ====== 全局状态 ======
  let allFiles = [];
  let searchTimer = null;
  let currentTab = 'downloads';
  let adminToken = null; // 前端简单记录密码
  let uploadConfig = null;
  let SUGGEST_MAX_SIZE = 2 * 1024 * 1024 * 1024;
  let MAX_DESC_LENGTH = 20;
  const UNSAFE_REGEX = /[<>"'`|&;\\\x00-\x1f]/g;

  // ====== 初始化 ======
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindTabSwitch();
    bindDownloadsTab();
    bindUploadTab();
    bindAdminModal();
    bindAdminModalEvents();
    loadUploadConfig(loadFiles);
    loadPendingCount();
  }

  // ====== Tab 切换 ======
  function bindTabSwitch() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
  }

  // ====== 隐藏管理入口：点击 Logo 7 次触发 ======
  // 间隔需 >= 500ms（慢速点击，非双击速度）
  function bindAdminModal() {
    const logoIcon = document.querySelector('.logo-icon');
    if (!logoIcon) return;
    let clickCount = 0;
    let lastClickTime = 0;
    const REQUIRED_CLICKS = 7;
    const MIN_INTERVAL = 500; // 最小间隔 500ms（低于此间隔不计入）
    const MAX_INTERVAL = 3000; // 超过 3 秒重新计数

    logoIcon.style.cursor = 'pointer';
    logoIcon.addEventListener('click', () => {
      const now = Date.now();
      if (lastClickTime > 0) {
        const gap = now - lastClickTime;
        if (gap < MIN_INTERVAL) {
          // 太快了，像双击，重新计数
          clickCount = 0;
          lastClickTime = 0;
          return;
        }
        if (gap > MAX_INTERVAL) {
          // 间隔太长，重新计数
          clickCount = 0;
        }
      }
      clickCount++;
      lastClickTime = now;

      // 第 1 次点击时启动超时重置
      if (clickCount === 1) {
        setTimeout(() => {
          if (Date.now() - lastClickTime >= MAX_INTERVAL && clickCount < REQUIRED_CLICKS) {
            clickCount = 0;
            lastClickTime = 0;
          }
        }, MAX_INTERVAL + 100);
      }

      if (clickCount >= REQUIRED_CLICKS) {
        clickCount = 0;
        lastClickTime = 0;
        openAdminModal();
      }
    });
  }

  function openAdminModal() {
    const modal = $('adminModal');
    modal.classList.remove('hidden');
    if (adminToken) {
      // 已登录，直接显示审核列表
      $('adminLoginArea').classList.add('hidden');
      $('adminPanel').classList.remove('hidden');
      loadPendingList();
    } else {
      $('adminLoginArea').classList.remove('hidden');
      $('adminPanel').classList.add('hidden');
      setTimeout(() => $('adminPwd').focus(), 100);
    }
  }

  function closeAdminModal() {
    $('adminModal').classList.add('hidden');
  }

  // ====== 上传配置 ======
  function loadUploadConfig(cb) {
    fetch('/api/upload-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          uploadConfig = d.data;
          SUGGEST_MAX_SIZE = d.data.suggestMaxSize || SUGGEST_MAX_SIZE;
          MAX_DESC_LENGTH = d.data.maxDescLength || MAX_DESC_LENGTH;
          const hint = $('sizeHint');
          const descMax = $('descMax');
          if (hint) hint.textContent = d.data.suggestMaxSizeFormatted || '2 GB';
          if (descMax) descMax.textContent = MAX_DESC_LENGTH;
        }
      })
      .catch(() => {})
      .finally(() => cb && cb());
  }

  // ====== 下载列表 Tab ======
  function bindDownloadsTab() {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilter, 200);
    });
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spin');
      setTimeout(() => refreshBtn.classList.remove('spin'), 600);
      loadFiles();
      loadPendingCount();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        loadFiles();
        loadPendingCount();
      }
    });
  }

  function getExtTagClass(ext) {
    const map = { 'EXE': 'tag-blue', 'MSI': 'tag-blue', 'ZIP': 'tag-orange', 'RAR': 'tag-orange', '7Z': 'tag-orange', 'TAR': 'tag-orange', 'GZ': 'tag-orange', 'ISO': 'tag-purple', 'DMG': 'tag-purple', 'PDF': 'tag-red', 'DOC': 'tag-darkblue', 'DOCX': 'tag-darkblue', 'XLS': 'tag-green', 'XLSX': 'tag-green', 'PPT': 'tag-orange-red', 'PPTX': 'tag-orange-red', 'TXT': 'tag-gray', 'SH': 'tag-green-dark', 'DEB': 'tag-pink', 'RPM': 'tag-pink', 'MP4': 'tag-cyan', 'MKV': 'tag-cyan' };
    return map[ext && ext.toUpperCase()] || 'tag-default';
  }

  function renderFiles(files) {
    fileTableBody.innerHTML = '';
    if (files.length === 0) {
      if (allFiles.length === 0) {
        hideAllStates();
        fileTableBody.closest('.table-wrapper').classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.querySelector('h3').textContent = '暂无文件';
        emptyState.querySelector('p').textContent = '等待管理员发布或前往「我要上传」分享文件';
      } else {
        hideAllStates();
        fileTableBody.closest('.table-wrapper').classList.add('hidden');
        noResultState.classList.remove('hidden');
      }
      return;
    }
    hideAllStates();
    fileTableBody.closest('.table-wrapper').classList.remove('hidden');

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      const extTagClass = getExtTagClass(file.extension);
      const downloadUrl = `/download/${encodeURIComponent(file.name)}`;
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.chineseName)}</span>
          </div>
          <div class="file-sub">
            <span class="version">${escapeHtml(file.version)}</span>
            <span class="file-realname mono" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          </div>
        </td>
        <td class="col-ext"><span class="ext-tag ${extTagClass}">${escapeHtml(file.extension || '-')}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.modifiedFormatted)}</td>
        <td class="col-action">
          <a href="${downloadUrl}" class="btn-download" download title="点击下载 · 支持断点续传">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>下载</span>
          </a>
        </td>`;
      const dlBtn = tr.querySelector('.btn-download');
      dlBtn.addEventListener('click', function () {
        const btn = this;
        btn.classList.add('downloading');
        setTimeout(() => btn.classList.remove('downloading'), 1200);
      });
      frag.appendChild(tr);
    });
    fileTableBody.appendChild(frag);
  }

  function hideAllStates() {
    emptyState.classList.add('hidden');
    noResultState.classList.add('hidden');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function loadFiles() {
    fileTableBody.innerHTML = `
      <tr class="loading-row">
        <td colspan="6">
          <div class="loading">
            <div class="spinner"></div>
            <span>正在读取文件列表...</span>
          </div>
        </td>
      </tr>`;
    fileCountBadge.textContent = '刷新中...';
    fileCountBadge.classList.add('badge-loading');
    fetch('/api/files', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        fileCountBadge.classList.remove('badge-loading');
        if (d.code === 0) {
          allFiles = d.data.files || [];
          fileCountBadge.textContent = `共 ${allFiles.length} 个文件`;
          applyFilter();
        } else {
          fileCountBadge.textContent = '加载失败';
          showErr(d.message || '加载失败');
        }
      })
      .catch((err) => {
        fileCountBadge.classList.remove('badge-loading');
        fileCountBadge.textContent = '网络错误';
        showErr('请求失败：' + err.message);
      });
  }

  function showErr(msg) {
    hideAllStates();
    fileTableBody.closest('.table-wrapper').classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = '加载出错';
    emptyState.querySelector('p').innerHTML = `<code>${escapeHtml(msg)}</code>`;
  }

  function applyFilter() {
    const kw = (searchInput.value || '').trim().toLowerCase();
    if (!kw) return renderFiles(allFiles);
    const filtered = allFiles.filter((f) =>
      (f.name || '').toLowerCase().includes(kw) ||
      (f.chineseName || '').toLowerCase().includes(kw) ||
      (f.description || '').toLowerCase().includes(kw) ||
      (f.version || '').toLowerCase().includes(kw) ||
      ((f.extension || '').toLowerCase().includes(kw))
    );
    renderFiles(filtered);
  }

  function loadPendingCount() {
    fetch('/api/pending-count', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const n = ((d && d.data) || {}).pendingCount || 0;
        if (n > 0) {
          pendingBadge.classList.remove('hidden');
          pendingBadge.textContent = n;
        } else {
          pendingBadge.classList.add('hidden');
        }
      })
      .catch(() => { });
  }

  // ====== 上传 Tab ======
  function bindUploadTab() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    const fileInfo = $('fileInfo');
    const fiName = fileInfo.querySelector('.fi-name');
    const fiSize = fileInfo.querySelector('.fi-size');
    const sizeWarn = $('sizeWarn');
    const changeBtn = $('changeFileBtn');
    const form = $('uploadForm');
    const submitBtn = $('submitBtn');
    const descInput = $('descInput');
    const descCount = $('descCount');
    const progressBox = $('progressBox');
    const pbStatus = $('pbStatus');
    const pbPercent = $('pbPercent');
    const pbFill = $('pbFill');
    const pbSpeed = $('pbSpeed');
    const pbRemain = $('pbRemain');
    const resultBox = $('resultBox');
    const resetBtn = $('resetBtn');

    // 描述字符过滤 + 计数
    descInput.addEventListener('input', function () {
      // 前端就做字符过滤
      let v = this.value.replace(UNSAFE_REGEX, '');
      if (v.length > MAX_DESC_LENGTH) v = v.slice(0, MAX_DESC_LENGTH);
      this.value = v;
      descCount.textContent = v.length;
      checkReady();
    });

    // 点击选择
    dropZone.addEventListener('click', () => fileInput.click());
    changeBtn.addEventListener('click', () => fileInput.click());

    // 拖拽
    ['dragenter', 'dragover'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      })
    );
    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelected();
      }
    });
    fileInput.addEventListener('change', handleFileSelected);

    function handleFileSelected() {
      const f = fileInput.files[0];
      if (!f) {
        fileInfo.classList.add('hidden');
        return;
      }
      dropZone.classList.add('hidden');
      fileInfo.classList.remove('hidden');
      fiName.textContent = f.name;
      fiSize.textContent = formatSize(f.size);
      if (f.size > SUGGEST_MAX_SIZE) {
        sizeWarn.classList.remove('hidden');
        sizeWarn.textContent = `⚠️ 超过建议 ${uploadConfig ? uploadConfig.suggestMaxSizeFormatted : '2 GB'}`;
      } else {
        sizeWarn.classList.add('hidden');
      }
      checkReady();
    }

    function checkReady() {
      const descOk = descInput.value.trim().length > 0;
      const fileOk = fileInput.files && fileInput.files.length > 0;
      submitBtn.disabled = !(descOk && fileOk);
    }

    resetBtn.addEventListener('click', (e) => {
      setTimeout(() => {
        descCount.textContent = '0';
        dropZone.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        progressBox.classList.add('hidden');
        resultBox.classList.add('hidden');
        submitBtn.disabled = true;
        pbFill.style.width = '0%';
      }, 0);
    });

    // 上传提交
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const file = fileInput.files[0];
      const desc = descInput.value.replace(UNSAFE_REGEX, '').slice(0, MAX_DESC_LENGTH).trim();
      if (!file || !desc) return;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('description', desc);
      const visInput = document.querySelector('input[name="visibility"]:checked');
      formData.append('visibility', visInput ? visInput.value : 'public');

      // XHR 做进度条
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      resultBox.classList.add('hidden');
      progressBox.classList.remove('hidden');
      submitBtn.disabled = true;
      let lastLoaded = 0;
      let lastTs = Date.now();
      let speed = 0;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          pbPercent.textContent = pct + '%';
          pbFill.style.width = pct + '%';
          const now = Date.now();
          const dt = now - lastTs;
          if (dt >= 500) {
            const dl = ev.loaded - lastLoaded;
            speed = (dl * 1000) / dt; // B/s
            pbSpeed.textContent = formatSize(speed) + '/s';
            const remainBytes = ev.total - ev.loaded;
            if (speed > 0) {
              const remainSec = Math.ceil(remainBytes / speed);
              pbRemain.textContent = formatTime(remainSec);
            } else {
              pbRemain.textContent = '-- 剩余';
            }
            lastLoaded = ev.loaded;
            lastTs = now;
          }
          if (pct === 100) {
            pbStatus.textContent = '服务器处理中...';
          } else {
            pbStatus.textContent = '上传中...';
          }
        }
      };

      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { }
        if (xhr.status === 200 && data.code === 0) {
          pbStatus.textContent = '上传成功';
          resultBox.className = 'result-box result-ok';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <div class="rb-main">
              <strong>${escapeHtml(data.message || '上传成功')}</strong>
              <p>${escapeHtml((data.data || {}).pendingMessage || '文件已进入待审核区，等待管理员审核通过后发布')}</p>
              ${data.data && data.data.overSuggested ? `<p class="rb-warn">你上传的文件 ${escapeHtml(data.data.sizeFormatted)}，已超过建议大小，审核可能更慢。</p>` : ''}
            </div>`;
          submitBtn.disabled = true;
          loadPendingCount();
        } else {
          pbStatus.textContent = '上传失败';
          resultBox.className = 'result-box result-err';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <div class="rb-main">
              <strong>上传失败</strong>
              <p>${escapeHtml(data.message || '网络错误，请重试')}</p>
            </div>`;
          submitBtn.disabled = false;
        }
      };

      xhr.onerror = () => {
        pbStatus.textContent = '上传失败';
        resultBox.className = 'result-box result-err';
        resultBox.classList.remove('hidden');
        resultBox.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <div class="rb-main"><strong>网络错误</strong><p>请检查网络连接后重试</p></div>`;
        submitBtn.disabled = false;
      };

      xhr.send(formData);
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(sec) {
    if (!sec || sec < 0) sec = 0;
    if (sec < 60) return sec + '秒 剩余';
    if (sec < 3600) return Math.floor(sec / 60) + '分' + (sec % 60) + '秒 剩余';
    return Math.floor(sec / 3600) + '时' + Math.floor((sec % 3600) / 60) + '分 剩余';
  }

  // ====== 审核弹窗事件绑定 ======
  function bindAdminModalEvents() {
    const loginBtn = $('adminLoginBtn');
    const pwdInput = $('adminPwd');
    const logoutBtn = $('logoutAdminBtn');
    const closeBtn = $('closeAdminModal');
    const modalOverlay = $('adminModal');
    const privateListBtn = $('privateListBtn');
    const backToPendingBtn = $('backToPendingBtn');

    loginBtn.addEventListener('click', loginAdmin);
    pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAdmin(); });
    logoutBtn.addEventListener('click', () => {
      adminToken = null;
      $('adminLoginArea').classList.remove('hidden');
      $('adminPanel').classList.add('hidden');
      $('privateListView').classList.add('hidden');
      pwdInput.value = '';
    });
    privateListBtn.addEventListener('click', showPrivateListView);
    backToPendingBtn.addEventListener('click', showAdminPanelView);
    closeBtn.addEventListener('click', closeAdminModal);
    // 点击遮罩关闭
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeAdminModal();
    });
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeAdminModal();
    });
  }

  function loginAdmin() {
    const pwd = $('adminPwd').value;
    if (!pwd) {
      alert('请输入管理员密码');
      return;
    }
    fetch(`/api/admin/pending?pwd=${encodeURIComponent(pwd)}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) throw new Error('密码错误');
        return r.json();
      })
      .then((d) => {
        if (d.code === 0) {
          adminToken = pwd;
          $('adminLoginArea').classList.add('hidden');
          $('adminPanel').classList.remove('hidden');
          renderPendingList(d.data.files || []);
        } else {
          throw new Error(d.message || '登录失败');
        }
      })
      .catch((e) => alert(e.message || '登录失败'));
  }

  function loadPendingList() {
    if (!adminToken) return;
    fetch(`/api/admin/pending?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) renderPendingList(d.data.files || []);
      })
      .catch((e) => console.error(e));
  }

  function renderPendingList(files) {
    const count = files.length;
    $('pendingCount').textContent = count;
    const pendingEmpty = $('pendingEmpty');
    const pendingWrapper = $('pendingWrapper');
    const tbody = $('pendingTableBody');

    if (count === 0) {
      pendingEmpty.classList.remove('hidden');
      pendingWrapper.classList.add('hidden');
      return;
    }
    pendingEmpty.classList.add('hidden');
    pendingWrapper.classList.remove('hidden');
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const ext = (file.name.split('.').pop() || '').toUpperCase();
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name">${escapeHtml(file.description || '(无描述)')}</span>
            ${file.overSuggested ? '<span class="tag-orange-red ml-xs">⚠️ 超2GB</span>' : ''}
          </div>
          <div class="file-sub">
            <span class="file-realname mono">${escapeHtml(file.originalName || file.name)}</span>
          </div>
        </td>
        <td class="col-ext"><span class="ext-tag ${getExtTagClass(ext)}">${ext || '-'}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.uploadedAtFormatted)}</td>
        <td class="col-action">
          <div class="btn-group-right">
            <button class="btn-approve" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>通过</span>
            </button>
            <button class="btn-reject" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>拒绝</span>
            </button>
          </div>
        </td>`;
      tr.querySelector('.btn-approve').addEventListener('click', function () {
        const nm = this.dataset.name;
        if (!confirm(`审核通过「${nm}」？该文件会加入下载列表公开。`)) return;
        adminAction('approve', nm);
      });
      tr.querySelector('.btn-reject').addEventListener('click', function () {
        const nm = this.dataset.name;
        if (!confirm(`确认拒绝并删除「${nm}」？此操作不可恢复。`)) return;
        adminAction('reject', nm);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function adminAction(type, filename) {
    const url = type === 'approve' ? '/api/admin/approve' : '/api/admin/reject';
    fetch(`${url}?pwd=${encodeURIComponent(adminToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          loadPendingList();
          loadFiles();
          loadPendingCount();
        } else {
          alert((type === 'approve' ? '审核通过失败' : '拒绝失败') + '：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  // ====== 私密文件列表 ======
  function showPrivateListView() {
    $('adminPanel').classList.add('hidden');
    $('privateListView').classList.remove('hidden');
    loadPrivateList();
  }

  function showAdminPanelView() {
    $('privateListView').classList.add('hidden');
    $('adminPanel').classList.remove('hidden');
  }

  function loadPrivateList() {
    if (!adminToken) return;
    fetch(`/api/admin/private-list?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) renderPrivateList(d.data.files || []);
      })
      .catch((e) => console.error(e));
  }

  function renderPrivateList(files) {
    const count = files.length;
    $('privateCount').textContent = count;
    const privateEmpty = $('privateEmpty');
    const privateWrapper = $('privateWrapper');
    const tbody = $('privateTableBody');

    if (count === 0) {
      privateEmpty.classList.remove('hidden');
      privateWrapper.classList.add('hidden');
      return;
    }
    privateEmpty.classList.add('hidden');
    privateWrapper.classList.remove('hidden');
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const ext = file.extension || (file.name.split('.').pop() || '').toUpperCase();
      const fullUrl = window.location.origin + file.downloadUrl;
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name" title="${escapeHtml(file.name)}">#${escapeHtml(file.chineseName)}</span>
          </div>
          <div class="file-sub">
            <span class="file-realname mono" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          </div>
        </td>
        <td class="col-ext"><span class="ext-tag ${getExtTagClass(ext)}">${escapeHtml(ext || '-')}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.modifiedFormatted)}</td>
        <td class="col-action">
          <div class="btn-group-right">
            <a href="${file.downloadUrl}" class="btn-download btn-small" download title="下载">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>下载</span>
            </a>
            <button class="btn-copy" data-url="${escapeHtml(fullUrl)}" title="复制直链">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>复制链接</span>
            </button>
          </div>
        </td>`;
      tr.querySelector('.btn-copy').addEventListener('click', function () {
        const url = this.dataset.url;
        const btn = this;
        const orig = btn.innerHTML;
        navigator.clipboard.writeText(url).then(() => {
          btn.innerHTML = '<span>已复制 ✓</span>';
          btn.classList.add('copied');
          setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
        }).catch(() => {
          const tmp = document.createElement('input');
          tmp.value = url;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          btn.innerHTML = '<span>已复制 ✓</span>';
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }
})();
