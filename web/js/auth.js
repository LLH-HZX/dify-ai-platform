/**
 * 认证模块：token 管理 / 当前用户
 * 依赖全局 API_BASE（见 api.js）
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'ai_portal_token';
  var USER_KEY = 'ai_portal_user';

  var Auth = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,

    loadUser: function () {
      try {
        this.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      } catch (e) {
        this.user = null;
      }
      return this.user;
    },

    isLoggedIn: function () {
      return !!this.token && !!this.user;
    },

    isAdmin: function () {
      return !!this.user && this.user.role === 'admin';
    },

    setSession: function (token, user) {
      this.token = token;
      this.user = user;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    clearSession: function () {
      this.token = '';
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },

    /**
     * 登录
     * @param {string} username
     * @param {string} password
     */
    login: async function (username, password) {
      var resp = await fetch(API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) {
        throw new Error(data.detail || '登录失败');
      }
      var me = await this.fetchMe(data.access_token);
      this.setSession(data.access_token, me);
      return me;
    },

    fetchMe: async function (token) {
      var resp = await fetch(API_BASE + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!resp.ok) throw new Error('获取用户信息失败');
      return await resp.json();
    },

    logout: function () {
      this.clearSession();
    },
  };

  window.Auth = Auth;
})();
