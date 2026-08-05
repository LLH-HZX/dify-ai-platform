/**
 * API 封装：统一携带 token，处理错误
 * 依赖 window.Auth
 */

// 后端地址：可通过页面上的全局变量覆盖
var API_BASE = window.API_BASE || 'http://127.0.0.1:8100';

(function () {
  'use strict';

  function getToken() {
    return window.Auth ? window.Auth.token : '';
  }

  /**
   * 通用请求
   */
  async function request(method, url, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var options = { method: method, headers: headers };
    if (body !== undefined) options.body = JSON.stringify(body);

    var resp = await fetch(API_BASE + url, options);

    // 401：token 失效，清除会话
    if (resp.status === 401) {
      if (window.Auth) window.Auth.clearSession();
      throw new Error('登录已过期，请重新登录');
    }

    if (resp.status === 204) return null;

    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      throw new Error(data.detail || '请求失败 (' + resp.status + ')');
    }
    return data;
  }

  var API = {
    get: function (url) { return request('GET', url); },
    post: function (url, body) { return request('POST', url, body); },
    put: function (url, body) { return request('PUT', url, body); },
    del: function (url) { return request('DELETE', url); },

    // 工作流
    listWorkflows: function () { return request('GET', '/api/workflows'); },
    listAllWorkflows: function () { return request('GET', '/api/workflows/all'); },
    createWorkflow: function (data) { return request('POST', '/api/workflows', data); },
    updateWorkflow: function (id, data) { return request('PUT', '/api/workflows/' + id, data); },
    deleteWorkflow: function (id) { return request('DELETE', '/api/workflows/' + id); },

    // 账号
    listAccounts: function () { return request('GET', '/api/accounts'); },
    createAccount: function (data) { return request('POST', '/api/accounts', data); },
    deleteAccount: function (username) { return request('DELETE', '/api/accounts/' + username); },

    // 后台统计
    getStats: function () { return request('GET', '/api/dashboard/stats'); },
    getRecent: function () { return request('GET', '/api/dashboard/recent?limit=50'); },

    // 知识库（RAGFlow 全局配置）
    getKnowledgeConfig: function () { return request('GET', '/api/knowledge/config'); },
    saveKnowledgeConfig: function (data) { return request('PUT', '/api/knowledge/config', data); },
    testKnowledge: function (data) { return request('POST', '/api/knowledge/test', data); },
  };

  /**
   * 流式聊天：通过 fetch + ReadableStream 读取 SSE
   * onChunk(deltaText) / onDone() / onError(message)
   */
  API.chat = function (payload, onChunk, onDone, onError) {
    var token = getToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    }).then(function (resp) {
      if (resp.status === 401) {
        if (window.Auth) window.Auth.clearSession();
        throw new Error('登录已过期，请重新登录');
      }
      if (!resp.ok) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          throw new Error(data.detail || '请求失败 (' + resp.status + ')');
        });
      }
      if (!resp.body) {
        throw new Error('当前浏览器不支持流式响应');
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var currentAnswer = '';
      var currentConversationId = '';
      var currentEvent = 'message';

      function handleDataLine(dataStr) {
        if (dataStr === '[DONE]') { onDone && onDone(currentAnswer, currentConversationId); return; }
        if (!dataStr) return;
        try {
          var obj = JSON.parse(dataStr);
          if (currentEvent === 'error') {
            onError && onError(obj.message || '请求出错');
            return;
          }
          if (obj.answer) {
            currentAnswer += obj.answer;
            onChunk && onChunk(obj.answer);
          }
          if (obj.conversation_id) currentConversationId = obj.conversation_id;
        } catch (e) { /* 忽略无法解析的行 */ }
      }

      function parse() {
        // 逐行解析 SSE，兼容事件之间有无空行的情况
        var lines = buffer.split('\n');
        buffer = '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('event:') === 0) {
            currentEvent = line.slice(6).trim();
          } else if (line.indexOf('data:') === 0) {
            handleDataLine(line.slice(5).trim());
          } else if (line === '') {
            currentEvent = 'message';
          }
        }
      }

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            buffer += decoder.decode();
            parse();
            onDone && onDone(currentAnswer, currentConversationId);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          parse();
          return pump();
        });
      }

      return pump();
    }).catch(function (err) {
      onError && onError(err.message || '请求失败');
    });
  };

  window.API = API;
})();
