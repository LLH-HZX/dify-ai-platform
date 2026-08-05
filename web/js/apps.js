/**
 * 工作流加载模块
 * 原为硬编码 apps 数组，现改为登录后从后端 API 动态获取
 * 依赖 window.API
 */
(function () {
  'use strict';

  var Apps = {
    list: [],

    /**
     * 从后端加载工作流列表
     */
    load: async function () {
      var wfs = await window.API.listWorkflows();
      // 只展示启用的工作流
      Apps.list = (wfs || []).filter(function (w) {
        return w.enabled !== false;
      });
      return Apps.list;
    },

    getById: function (id) {
      return Apps.list.find(function (a) { return a.id === id; }) || null;
    },
  };

  window.Apps = Apps;
})();
