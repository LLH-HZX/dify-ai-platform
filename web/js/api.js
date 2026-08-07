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

    // 文件上传：multipart 方式，返回 {upload_file_id, name, size, type}
    // onProgress: 可选回调 (percent 0-100, event)
    upload: function (file, onProgress) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        fd.append('file', file);
        var token = getToken();

        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/api/upload');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

        if (typeof onProgress === 'function' && xhr.upload) {
          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100), e);
            }
          };
        }

        xhr.onload = function () {
          var data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = {}; }
          if (xhr.status === 401) {
            if (window.Auth) window.Auth.clearSession();
            reject(new Error('登录已过期，请重新登录'));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.detail || '上传失败 (' + xhr.status + ')'));
          }
        };
        xhr.onerror = function () { reject(new Error('网络错误，上传失败')); };
        xhr.onabort = function () { reject(new Error('上传已取消')); };

        xhr.send(fd);
      });
    },

    // 工作流
    listWorkflows: function () { return request('GET', '/api/workflows'); },
    listAllWorkflows: function () { return request('GET', '/api/workflows/all'); },
    createWorkflow: function (data) { return request('POST', '/api/workflows', data); },
    updateWorkflow: function (id, data) { return request('PUT', '/api/workflows/' + id, data); },
    deleteWorkflow: function (id) { return request('DELETE', '/api/workflows/' + id); },
    // 上传工作流图标（仅管理员，只允许图片，返回 {url}）
    // 把后端返回的相对路径（如 /uploads/xxx.png）转成完整可访问 URL
    resolveUrl: function (url) {
      if (!url) return '';
      if (/^https?:\/\//i.test(url)) return url;
      return API_BASE + url;
    },
    uploadIcon: function (file) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData();
        fd.append('file', file);
        var token = getToken();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/api/upload/icon');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = function () {
          var data = {};
          try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = {}; }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.detail || '上传失败 (' + xhr.status + ')'));
          }
        };
        xhr.onerror = function () { reject(new Error('网络错误，上传失败')); };
        xhr.send(fd);
      });
    },

    // 类型图标（门户类型选择页）
    getTypeIcons: function () { return request('GET', '/api/types/icons'); },
    saveTypeIcon: function (typeName, url) {
      return request('PUT', '/api/types/icons/' + encodeURIComponent(typeName), { url: url });
    },

    // 账号
    listAccounts: function () { return request('GET', '/api/accounts'); },
    createAccount: function (data) { return request('POST', '/api/accounts', data); },
    updateAccount: function (username, data) { return request('PUT', '/api/accounts/' + username, data); },
    deleteAccount: function (username) { return request('DELETE', '/api/accounts/' + username); },

    // 后台统计
    getStats: function () { return request('GET', '/api/dashboard/stats'); },
    getRecent: function () { return request('GET', '/api/dashboard/recent?limit=50'); },
    getAuditLogs: function () { return request('GET', '/api/dashboard/audit?limit=100'); },

    // 会话历史（历史记录 + 续聊）
    listSessions: function () { return request('GET', '/api/sessions'); },
    getSession: function (id) { return request('GET', '/api/sessions/' + encodeURIComponent(id)); },
    deleteSession: function (id) { return request('DELETE', '/api/sessions/' + encodeURIComponent(id)); },
  };

  // 把 workflow 的 outputs（对象）转成可展示的文本
  function workflowOutputsToText(outputs) {
    if (!outputs || typeof outputs !== 'object') return '';
    var parts = [];
    Object.keys(outputs).forEach(function (k) {
      var v = outputs[k];
      if (typeof v === 'string' && v.trim()) {
        parts.push(v);
      } else if (v && typeof v === 'object') {
        try { parts.push(JSON.stringify(v)); } catch (e) { /* ignore */ }
      }
    });
    var text = parts.join('\n\n');
    // 去掉 <think>...</think> 思考块，只保留给用户看的回答
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return text;
  }

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
      var currentSessionId = '';
      var currentEvent = 'message';

      function handleDataLine(dataStr) {
        // [DONE] 仅标记 Dify 流结束；onDone 统一在 result.done 时触发，以便捕获 session 事件
        if (dataStr === '[DONE]') { return; }
        if (!dataStr) return;
        try {
          var obj = JSON.parse(dataStr);
          if (currentEvent === 'session') {
            if (obj.session_id) currentSessionId = obj.session_id;
            return;
          }
          if (currentEvent === 'error') {
            onError && onError(obj.message || '请求出错');
            return;
          }
          if (obj.answer) {
            currentAnswer += obj.answer;
            onChunk && onChunk(obj.answer);
          }
          // workflow 类型：结果在 workflow_finished 的 data.outputs 里（无 answer 字段）
          if (obj.event === 'workflow_finished' && obj.data && obj.data.outputs) {
            var wfText = workflowOutputsToText(obj.data.outputs);
            if (wfText) {
              currentAnswer += wfText;
              onChunk && onChunk(wfText);
            }
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
            onDone && onDone(currentAnswer, currentConversationId, currentSessionId);
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
