/**
 * 主逻辑：登录路由 / 权限控制 / 页面切换 / 渲染应用卡片
 * 依赖 window.Auth, window.API, window.Apps, window.Chat, window.Admin
 */
(function () {
  'use strict';

  var views = {
    login: document.getElementById('login-view'),
    portal: document.getElementById('portal-view'),
    admin: document.getElementById('admin-view'),
  };

  var currentView = null;

  function showView(name) {
    if (currentView === name) return;
    ['login', 'portal', 'admin'].forEach(function (k) {
      views[k].hidden = (k !== name);
    });
    currentView = name;
  }

  // ═══════════════ 渲染应用卡片 ═══════════════
  function renderApps() {
    var grid = document.getElementById('apps-grid');
    var apps = window.Apps.list;

    if (!apps.length) {
      grid.innerHTML = '<p class="empty-tip">暂无可用应用</p>';
      return;
    }

    grid.innerHTML = apps.map(function (app) {
      var color = app.color || '#2563EB';
      return (
        '<article class="app-card" data-id="' + escAttr(app.id) + '" tabindex="0" role="button" aria-label="打开 ' + escAttr(app.name || 'AI应用') + '">' +
          '<div class="app-card__icon" style="background-color:' + color + '1A; color:' + color + ';">' +
            '<span>' + esc(app.icon || '🤖') + '</span>' +
          '</div>' +
          '<div class="app-card__body">' +
            '<h3 class="app-card__title">' + esc(app.name) + '</h3>' +
            '<p class="app-card__desc">' + esc(app.description || '') + '</p>' +
          '</div>' +
          '<div class="app-card__action">' +
            '<span class="app-card__badge">' + esc(app.type || 'Dify') + '</span>' +
            '<span class="app-card__arrow">→</span>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    grid.querySelectorAll('.app-card').forEach(function (card) {
      card.addEventListener('click', function () { window.Chat.open(card.getAttribute('data-id')); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.Chat.open(card.getAttribute('data-id'));
        }
      });
    });
  }

  // ═══════════════ 用户信息展示 ═══════════════
  function renderUserChips() {
    var user = window.Auth.user;
    var label = user ? (user.username + (user.role === 'admin' ? '（管理员）' : '')) : '';
    var avatar = document.getElementById('user-avatar');
    var adminAvatar = document.getElementById('admin-user-chip');
    if (avatar) avatar.textContent = label;
    if (adminAvatar) adminAvatar.textContent = label;
  }

  // ═══════════════ 进入门户 ═══════════════
  async function enterPortal() {
    showView('portal');
    renderUserChips();

    // 管理员显示后台入口
    var adminBtn = document.getElementById('admin-btn');
    var backBtn = document.getElementById('back-btn');
    adminBtn.hidden = !window.Auth.isAdmin();
    backBtn.hidden = true;

    var grid = document.getElementById('apps-grid');
    grid.innerHTML = '<p class="empty-tip">加载中...</p>';
    try {
      await window.Apps.load();
      renderApps();
    } catch (e) {
      grid.innerHTML = '<p class="empty-tip">' + esc(e.message || '加载失败') + '</p>';
    }
  }

  // ═══════════════ 进入管理后台 ═══════════════
  var adminInitialized = false;
  async function enterAdmin() {
    if (!window.Auth.isAdmin()) {
      window.showToast('无权限访问管理后台');
      return;
    }
    showView('admin');
    renderUserChips();
    if (!adminInitialized) {
      window.Admin.init();
      adminInitialized = true;
    }
    window.Admin.switchTab('workflows');
  }

  // ═══════════════ 登录流程 ═══════════════
  function bindLogin() {
    var form = document.getElementById('login-form');
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = '登录中...';
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      try {
        var me = await window.Auth.login(username, password);
        if (me.role === 'admin') {
          await enterAdmin();
        } else {
          await enterPortal();
        }
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = '登 录';
      }
    });
  }

  // ═══════════════ 顶部导航事件 ═══════════════
  function bindNav() {
    // 退出登录（门户）
    document.getElementById('logout-btn').addEventListener('click', doLogout);
    // 退出登录（后台）
    document.getElementById('admin-logout-btn').addEventListener('click', doLogout);
    // 进入后台
    document.getElementById('admin-btn').addEventListener('click', function () {
      enterAdmin();
    });
    // 后台返回门户
    document.getElementById('admin-back-portal').addEventListener('click', function () {
      enterPortal();
    });
    // 门户返回（如从后台返回后，back-btn 隐藏，暂不使用）
    document.getElementById('back-btn').addEventListener('click', function () {
      enterPortal();
    });
  }

  function doLogout() {
    window.Auth.logout();
    window.location.reload();
  }

  // ═══════════════ 初始化 ═══════════════
  function init() {
    window.Chat.init();
    bindLogin();
    bindNav();

    var user = window.Auth.loadUser();
    if (window.Auth.isLoggedIn()) {
      if (user.role === 'admin') {
        enterAdmin();
      } else {
        enterPortal();
      }
    } else {
      showView('login');
    }
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 工具
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(str) { return esc(str); }
})();
