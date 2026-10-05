// 接続・認証の土台。ゲームの保存・進行とは独立しています。
(function () {
  'use strict';
  if (window.TorequeSupabase) return; // 二重読み込みでもClientは1つだけ。

  // 公式ドキュメントで案内されているjsDelivr。バージョンを固定します。
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const TIMEOUT_MS = 10000;
  const config = window.TorequeSupabaseConfig || {};
  const key = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
  let client = null;
  let state = { status: 'loading', message: 'SDKを読み込み中です。' };
  let settle;
  const ready = new Promise(resolve => { settle = resolve; });

  function finish(status, message) {
    state = { status, message };
    settle({ ...state }); // 失敗もresolveし、未処理のPromiseエラーを出しません。
  }

  // コンソールから明示的に実行する、書き込みのない接続確認。
  async function checkConnection() {
    await ready;
    if (!client) return { ok: false, ...state };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(config.projectUrl + '/auth/v1/settings', {
        method: 'GET', headers: { apikey: key }, signal: controller.signal,
        credentials: 'omit', cache: 'no-store'
      });
      return {
        ok: response.ok,
        httpStatus: response.status,
        message: response.ok ? 'Supabaseへの接続を確認しました。' : '接続先またはPublishable keyを確認してください。'
      };
    } catch (_) {
      return { ok: false, message: '接続できませんでした。通信環境と設定を確認してください。' };
    } finally {
      clearTimeout(timeout);
    }
  }

  window.TorequeSupabase = Object.freeze({
    get client() { return client; },
    ready,
    getStatus: () => ({ ...state }),
    checkConnection
  });

  if (!key) {
    finish('missing-key', 'supabase-config.jsにPublishable keyを設定してください。');
    return;
  }
  // 公開キーだけを受け付け、秘密キーや旧形式のJWTを送信しません。
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    finish('invalid-key', 'sb_publishable_で始まるPublishable keyを使用してください。');
    return;
  }
  if (config.projectUrl !== 'https://iiidlpmjtqnvrskutvrx.supabase.co') {
    finish('invalid-url', 'Project URLを確認してください。');
    return;
  }

  // 外部SDKは非同期読み込み。既存ゲームの起動を待たせません。
  const script = document.createElement('script');
  script.src = SDK_URL;
  script.async = true;
  let finished = false;
  const timeout = setTimeout(() => end('unavailable', 'SDKの読み込みが時間切れになりました。再読み込みで再試行できます。'), TIMEOUT_MS);
  function end(status, message) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    script.onload = script.onerror = null;
    finish(status, message);
  }
  script.onload = () => {
    if (finished) return;
    try {
      // 標準のセッション保存・自動更新・メール確認URL検出を利用。
      // SDK専用キーで管理され、ゲームのセーブキーには触れません。
      client = window.supabase.createClient(config.projectUrl, key);
      end('ready', 'Clientを準備しました。接続確認はcheckConnection()で行えます。');
    } catch (_) {
      end('unavailable', 'Clientを準備できませんでした。既存ゲームはそのまま利用できます。');
    }
  };
  script.onerror = () => end('unavailable', 'SDKを読み込めませんでした。既存ゲームはそのまま利用できます。');
  try {
    document.head.appendChild(script);
  } catch (_) {
    end('unavailable', 'SDKを読み込めませんでした。');
  }
})();
