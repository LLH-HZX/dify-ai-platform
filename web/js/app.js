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
  function renderApps(apps) {
    var grid = document.getElementById('apps-grid');
    apps = apps || window.Apps.list;

    if (!apps.length) {
      // 区分提示：admin 看全部为空=确实没应用；普通用户为空=未被授权
      var isAdmin = window.Auth.isAdmin && window.Auth.isAdmin();
      if (isAdmin) {
        grid.innerHTML = '<p class="empty-tip">该类型下暂无可用应用</p>';
      } else {
        grid.innerHTML = '<div class="empty-tip empty-tip--permission">🔒 暂无权限使用该类型，请联系管理员授权</div>';
      }
      return;
    }

    grid.innerHTML = apps.map(function (app) {
      var color = app.color || '#2563EB';
      // 有自定义图标图片则用 <img>（转完整 URL），否则显示应用名首字符
      var iconHtml;
      if (app.icon) {
        var iconUrl = (window.API && window.API.resolveUrl) ? window.API.resolveUrl(app.icon) : app.icon;
        iconHtml = '<img src="' + escAttr(iconUrl) + '" alt="" />';
      } else {
        iconHtml = '<span>' + esc((app.name || 'AI').charAt(0)) + '</span>';
      }
      return (
        '<article class="app-card" data-id="' + escAttr(app.id) + '" tabindex="0" role="button" aria-label="打开 ' + escAttr(app.name || 'AI应用') + '">' +
          '<div class="app-card__icon" style="background-color:' + color + '1A; color:' + color + ';">' + iconHtml + '</div>' +
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

  // ═══════════════ 类型选择卡片 ═══════════════
  // 类型元信息：无图标时显示英文 key（chat/work/agent）
  var TYPE_META = [
    { type: 'chatflow', name: '对话流', desc: 'Chatflow · 问答式对话', fallback: 'chat' },
    { type: 'workflow', name: '工作流', desc: 'Workflow · 任务式运行', fallback: 'work' },
    { type: 'agent',    name: '智能体', desc: 'Agent · 工具化智能对话', fallback: 'agent' },
  ];
  var TYPE_ICONS = {}; // 类型图标缓存 {type: url}
  var typeIconFileInput = null; // 管理员上传图标用的隐藏 input

  // 渲染类型选择卡片（图标来自后端配置，无图显示英文 key）
  function renderTypeSelect() {
    var grid = document.getElementById('apps-type-select');
    grid.innerHTML = TYPE_META.map(function (m) {
      var iconUrl = TYPE_ICONS[m.type];
      var iconHtml;
      if (iconUrl) {
        iconHtml = '<img src="' + escAttr(window.API.resolveUrl(iconUrl)) + '" alt="' + escAttr(m.name) + '" />';
      } else {
        iconHtml = '<span class="type-select-icon__fallback">' + esc(m.fallback) + '</span>';
      }
      return (
        '<button type="button" class="type-select-card" data-type="' + m.type + '">' +
          '<div class="type-select-icon">' + iconHtml + '</div>' +
          '<div class="type-select-name">' + esc(m.name) + '</div>' +
          '<div class="type-select-desc">' + esc(m.desc) + '</div>' +
        '</button>'
      );
    }).join('');

    // 重新绑定卡片点击
    grid.querySelectorAll('.type-select-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        // 管理员点击图标区域 → 弹上传，不进入列表
        if (e.target.closest && e.target.closest('.type-select-icon') && window.Auth.isAdmin()) {
          e.stopPropagation();
          triggerTypeIconUpload(card.getAttribute('data-type'));
          return;
        }
        showAppsByType(card.getAttribute('data-type'));
      });
    });
  }

  // 显示类型选择页
  function showTypeSelect() {
    document.getElementById('apps-type-select').hidden = false;
    document.getElementById('apps-list-wrap').hidden = true;
    loadTypeIcons();
  }

  // 从后端加载类型图标并渲染
  function loadTypeIcons() {
    window.API.getTypeIcons().then(function (icons) {
      TYPE_ICONS = icons || {};
      renderTypeSelect();
    }).catch(function () {
      // 加载失败保留默认空图标，仍渲染英文 key 占位
      TYPE_ICONS = {};
      renderTypeSelect();
    });
  }

  // 管理员点击类型图标 → 弹出文件上传并保存
  function triggerTypeIconUpload(typeName) {
    if (!window.Auth.isAdmin()) return;
    if (!typeIconFileInput) {
      typeIconFileInput = document.createElement('input');
      typeIconFileInput.type = 'file';
      typeIconFileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
      typeIconFileInput.style.display = 'none';
      document.body.appendChild(typeIconFileInput);
      typeIconFileInput.addEventListener('change', function () {
        var file = typeIconFileInput.files && typeIconFileInput.files[0];
        typeIconFileInput.value = '';
        if (!file) return;
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
          window.showToast('仅支持 png/jpeg/gif/webp 图片');
          return;
        }
        if (file.size > 3 * 1024 * 1024) {
          window.showToast('图标不能超过 3MB');
          return;
        }
        window.showToast('正在上传图标...');
        window.API.uploadIcon(file).then(function (data) {
          return window.API.saveTypeIcon(typeName, data.url || '');
        }).then(function () {
          window.showToast('类型图标已更新');
          loadTypeIcons();
        }).catch(function (err) {
          window.showToast(err.message || '更新失败');
        });
      });
    }
    typeIconFileInput.click();
  }

  // 按类型显示应用列表
  function showAppsByType(type) {
    var allApps = window.Apps.list || [];
    var apps = allApps.filter(function (a) { return (a.type || 'chatflow') === type; });
    var titleEl = document.getElementById('apps-type-title');
    var titleText = type === 'workflow' ? '工作流' : (type === 'agent' ? '智能体' : '对话流');
    titleEl.textContent = titleText + '（' + apps.length + '）';

    // 普通用户进入无权限类型时仍显示，但列表为空并提示
    document.getElementById('apps-type-select').hidden = true;
    document.getElementById('apps-list-wrap').hidden = false;
    renderApps(apps);
  }

  // 绑定类型选择返回按钮（卡片点击事件在 renderTypeSelect 中动态绑定）
  function bindTypeSelect() {
    document.getElementById('apps-back-type').addEventListener('click', function () {
      showTypeSelect();
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

    try {
      await window.Apps.load();
      showTypeSelect();
    } catch (e) {
      document.getElementById('apps-grid').innerHTML = '<p class="empty-tip">' + esc(e.message || '加载失败') + '</p>';
      showTypeSelect();
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
    bindTypeSelect();

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
