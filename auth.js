/* 認証とアカウントUI。クラウド通信はcloud-save.jsへ分離しています。 */
(function () {
  'use strict';
  const dialog = document.createElement('dialog');
  dialog.className = 'exercise-dialog auth-dialog';
  dialog.setAttribute('aria-labelledby', 'auth-title');
  dialog.innerHTML = '<div class="eyebrow">ADVENTURER ACCOUNT</div><h2 id="auth-title">ログイン</h2><p class="auth-note">ログインしなくても冒険を続けられます。ゲームデータはこのブラウザに保存されます。</p><div id="auth-account" hidden><p>ログイン中</p><strong id="auth-email"></strong><button class="primary" id="auth-logout">ログアウト</button></div><form id="auth-form"><label for="auth-input-email">メールアドレス</label><input id="auth-input-email" type="email" autocomplete="email" required maxlength="254"><label for="auth-password">パスワード</label><input id="auth-password" type="password" autocomplete="current-password" required minlength="6"><p class="auth-note">パスワードは6文字以上。登録先の設定により追加条件が必要な場合があります。</p><button class="primary" id="auth-submit" type="submit">ログイン</button><button class="auth-switch" id="auth-switch" type="button">アカウントを持っていない方 → 新規登録</button></form><p id="auth-message" class="auth-message" role="status" aria-live="polite"></p><button class="secondary" id="auth-close">閉じる</button>';
  document.body.appendChild(dialog);
  const el = id => dialog.querySelector('#' + id);
  el('auth-account').innerHTML += '<section class="cloud-panel" id="cloud-panel" hidden><h3>クラウド保存</h3><p id="cloud-status" role="status" aria-live="polite"></p><p id="cloud-message" class="auth-note"></p><div id="cloud-comparison" hidden><section class="cloud-save-card"><h4 id="cloud-local-title">この端末のデータ</h4><p id="cloud-local-summary"></p></section><section class="cloud-save-card" id="cloud-remote-card"><h4>クラウドのデータ</h4><p id="cloud-remote-summary"></p></section></div><button class="primary" id="cloud-use-local" hidden>この端末のデータを使用</button><button class="secondary" id="cloud-use-remote" hidden>クラウドのデータを使用</button><button class="secondary" id="cloud-decline" hidden>引き継がず新しい冒険を始める</button><button class="secondary" id="cloud-sync">今すぐ同期</button></section>';
  el('auth-account').innerHTML += '<button class="secondary account-delete-button" id="account-delete-open">アカウントを削除</button>';
  dialog.innerHTML += '<p id="auth-game-note" class="auth-note"></p>';
  dialog.innerHTML += '<section id="auth-workout-summary" hidden><p id="auth-workout-email"></p><h3>クラウド保存</h3><p id="auth-workout-cloud" role="status"></p><p class="auth-note">トレーニング中はアカウントの変更はできません。トレーニングを完了するか、中断してホームへ戻ってから操作してください。</p></section>';
  el('auth-account').innerHTML += '<button class="secondary" id="auth-official-refresh" hidden>正式な記録を再確認</button>';
  const authListeners = new Set();
  const gameBusy = () => {
    // HOMEを経由しない認証表示でも、確認済み終了sessionだけ整理する。renderの再帰通知は不要。
    TorequeWorkout.releaseFinished?.(false);
    return TorequeWorkout.isActive?.() || (typeof clearEffectActive !== 'undefined' && clearEffectActive);
  };
  let user = null, available = false, initializing = true, busy = false, mode = 'login';
  let message = '', isError = false, releasePause = null, revision = 0;
  function notifyAuth() {
    const snapshot = getState();
    authListeners.forEach(fn => { try { fn(snapshot); } catch { /* 同期の失敗で認証を止めません。 */ } });
  }
  function getState() { return { loggedIn: !!user, userId: user?.id || null, email: user?.email || null, available, initializing }; }
  function summary(save) {
    if (!save) return '冒険データなし';
    if (window.TorequeOfficial?.managed()) return '初回質問・ユーザー設定・メニュー設定\nXP・クリア・評価などの正式成果は、この選択で移行／上書きされません。';
    const xp = Number.isFinite(save.progress?.xp) ? Math.max(0, Math.min(1000000000, save.progress.xp)) : 0;
    const history = save.progress?.history || {};
    const days = Object.entries(history).filter(([id, value]) => /^\d+$/.test(id) && value?.completed).length;
    const dates = Object.values(history).flatMap(value => Array.isArray(value?.runs) ? value.runs : []).map(run => run?.completedAt).filter(date => typeof date === 'string' && Number.isFinite(Date.parse(date))).sort();
    const last = dates.at(-1) || save.progress?.lastTrainingDate;
    return `Lv.${TorequeProgress.levelState(xp).level} / TOTAL XP ${xp}\nクリア済みDAY：${days}\n最終トレーニング：${last ? new Date(last).toLocaleString('ja-JP') : 'まだありません'}`;
  }
  function renderCloud() {
    const cloud = window.TorequeCloud;
    el('cloud-panel').hidden = !user;
    if (!user) return;
    // 読み込み失敗を「表示なし」にしない。認証・ローカル保存は継続できます。
    if (!cloud || typeof cloud.getState !== 'function') {
      el('cloud-status').textContent = '● 確認が必要';
      el('cloud-status').className = 'cloud-status attention';
      el('cloud-message').textContent = 'クラウド保存を準備できませんでした。ページを再読み込みしてください。解決しない場合は管理者に連絡してください。';
      ['cloud-comparison', 'cloud-use-local', 'cloud-use-remote', 'cloud-decline'].forEach(id => { el(id).hidden = true; });
      el('cloud-sync').disabled = true;
      return;
    }
    const s = cloud.getState();
    const labels = { synced: '同期済み', unsynced: '未同期', offline: 'オフライン', attention: '確認が必要', invalid: '確認が必要', deferred: '確認が必要', syncing: '同期中', guest: '確認中' };
    el('cloud-status').textContent = '● ' + (labels[s.status] || '確認が必要');
    el('cloud-status').className = 'cloud-status ' + s.status;
    el('cloud-message').textContent = s.message;
    el('cloud-comparison').hidden = !s.choice;
    el('cloud-local-title').textContent = s.choice === 'inherit' ? '未ログイン時の冒険データ' : 'この端末のデータ';
    el('cloud-local-summary').textContent = summary(s.local);
    el('cloud-remote-summary').textContent = summary(s.cloud);
    el('cloud-remote-card').hidden = !s.cloud;
    el('cloud-use-local').hidden = !s.choice || !s.local;
    el('cloud-use-local').textContent = s.choice === 'inherit' ? 'この冒険をアカウントへ引き継ぐ' : 'この端末のデータを使用';
    el('cloud-use-remote').hidden = s.choice !== 'conflict' || !s.cloud;
    el('cloud-decline').hidden = s.choice !== 'inherit';
    ['cloud-use-local', 'cloud-use-remote', 'cloud-decline'].forEach(id => { el(id).disabled = s.busy || gameBusy(); });
    el('cloud-sync').disabled = s.busy || gameBusy();
  }

  function errorText(error) {
    const code = error && error.code;
    const messages = {
      invalid_credentials: 'メールアドレスまたはパスワードが違います。',
      email_not_confirmed: 'メール確認がまだ完了していません。確認メール内のリンクを開いてください。',
      user_already_exists: '登録済みのメールアドレスです。ログインしてください。',
      email_exists: '登録済みのメールアドレスです。ログインしてください。',
      weak_password: 'パスワードが登録条件を満たしていません。文字数や文字の種類を見直してください。',
      email_address_invalid: 'メールアドレスの形式を確認してください。',
      signup_disabled: '現在、新規登録は受け付けていません。',
      over_email_send_rate_limit: 'メール送信が多すぎます。少し待ってからお試しください。',
      over_request_rate_limit: '操作が多すぎます。少し待ってからお試しください。',
      email_address_not_authorized: 'このメールアドレスへ送信できません。管理者にメール送信設定の確認を依頼してください。',
      session_not_found: 'ログイン状態を確認できません。もう一度ログインしてください。'
    };
    if (messages[code]) return messages[code];
    if (error && (error.status === 429)) return '操作が多すぎます。少し待ってからお試しください。';
    return '認証できませんでした。通信環境や入力内容を確認し、もう一度お試しください。';
  }
  function render() {
    const restricted = gameBusy();
    el('auth-title').textContent = user ? 'アカウント' : mode === 'signup' ? '新規登録' : 'ログイン';
    el('auth-account').hidden = !user || restricted;
    el('auth-email').textContent = user ? user.email || 'ログイン済み' : '';
    el('auth-form').hidden = !!user || restricted;
    el('auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    el('auth-submit').textContent = busy ? '処理中…' : mode === 'signup' ? '新規登録' : 'ログイン';
    el('auth-switch').textContent = mode === 'signup' ? 'すでにアカウントを持っている方 → ログイン' : 'アカウントを持っていない方 → 新規登録';
    ['auth-submit', 'auth-switch', 'auth-input-email', 'auth-password', 'auth-logout'].forEach(id => { el(id).disabled = busy || !available || gameBusy(); });
    el('auth-game-note').textContent = gameBusy() ? 'トレーニング・クリア演出を終了してから、ログインやデータの切り替えを行ってください。' : '';
    el('auth-message').textContent = initializing ? 'ログイン状態を確認中…' : message;
    el('auth-message').classList.toggle('auth-error', isError);
    renderCloud();
    if (user && window.TorequeOfficial) {
      const official = window.TorequeOfficial.getState();
      el('auth-game-note').textContent += (gameBusy() ? '\n' : '') + (official.ready ? '正式な成果：サーバー記録を使用しています。' : '正式な成果：' + (official.message || '記録を確認中…'));
    }
    el('auth-official-refresh').hidden = !user || !window.TorequeOfficial;
    el('auth-official-refresh').disabled = gameBusy() || busy || !!window.TorequeAccountDelete?.isBusy();
    el('account-delete-open').disabled = busy || !available || gameBusy() || !!window.TorequeAccountDelete?.isBusy();
    el('auth-workout-summary').hidden = !restricted;
    dialog.querySelector('.auth-note').hidden = restricted;
    el('auth-game-note').hidden = restricted;
    el('auth-message').hidden = restricted;
    if (restricted) {
      el('auth-workout-email').textContent = user ? user.email || 'ログイン済み' : '未ログインでプレイ中';
      const cloudState = window.TorequeCloud?.getState().status;
      const labels = { synced: '同期済み', syncing: '同期中', unsynced: '未同期', offline: 'オフライン', attention: '確認が必要', invalid: '確認が必要', deferred: '確認が必要' };
      el('auth-workout-cloud').textContent = user ? '● ' + (labels[cloudState] || '確認中') : '端末に保存';
    }
  }
  function tell(text, error = false) { message = text; isError = error; render(); }
  function open() {
    if (dialog.open) return;
    // MENUから開いた場合も既存のモーダル一時停止を利用。
    releasePause = TorequeWorkout.suspendForModal();
    render(); dialog.showModal();
  }
  dialog.onclose = () => {
    el('auth-password').value = '';
    if (releasePause) releasePause();
    releasePause = null;
  };
  el('auth-close').onclick = () => dialog.close();
  el('auth-switch').onclick = () => {
    if (busy) return;
    mode = mode === 'signup' ? 'login' : 'signup';
    el('auth-password').value = ''; tell('');
  };
  el('auth-form').onsubmit = async event => {
    event.preventDefault();
    if (busy || !available || user || gameBusy() || !el('auth-form').reportValidity()) return;
    busy = true; tell('');
    const credentials = { email: el('auth-input-email').value.trim(), password: el('auth-password').value };
    try {
      let result;
      if (mode === 'signup') {
        const options = {};
        // file://はメールの戻り先に使えないため、管理画面のSite URLを利用。
        if (/^https?:$/.test(location.protocol)) options.emailRedirectTo = location.origin + location.pathname;
        result = await TorequeSupabase.client.auth.signUp({ ...credentials, options });
      } else result = await TorequeSupabase.client.auth.signInWithPassword(credentials);
      if (result.error) { tell(errorText(result.error), true); return; }
      user = result.data.session ? result.data.session.user : null;
      notifyAuth();
      el('auth-password').value = '';
      tell(user ? 'ログインしました。冒険を続けよう！' : '確認メールを送信しました。メール内のリンクを開いて登録を完了してください。');
    } catch (_) { tell(errorText(null), true); }
    finally { busy = false; render(); }
  };
  el('auth-logout').onclick = async () => {
    if (busy || !available || gameBusy() || window.TorequeAccountDelete?.isBusy()) return;
    busy = true; tell('');
    try {
      const { error } = await TorequeSupabase.client.auth.signOut({ scope: 'local' });
      if (error) { tell(errorText(error), true); return; }
      user = null; notifyAuth(); tell('ログアウトしました。ゲームの記録はそのまま残っています。');
    } catch (_) { tell(errorText(null), true); }
    finally { busy = false; render(); }
  };
  const ready = (async () => {
    try {
      await TorequeSupabase.ready;
      const client = TorequeSupabase.client;
      if (!client) { message = '認証を利用できません。通信環境とSupabaseの設定を確認してください。'; return; }
      // コールバック内から別のAuth APIを呼ばず、SDKのロック競合を避けます。
      client.auth.onAuthStateChange((event, session) => {
        revision++; user = session ? session.user : null;
        notifyAuth();
        if (event === 'SIGNED_OUT') message = 'ログアウトしました。';
        if (dialog.open) render();
      });
      const before = revision;
      const { data, error } = await client.auth.getSession();
      if (error) { message = errorText(error); isError = true; }
      if (before === revision) user = data && data.session ? data.session.user : null;
      available = true;
    } catch (_) { message = errorText(null); isError = true; }
    finally { initializing = false; notifyAuth(); render(); }
  })();
  el('account-delete-open').onclick = () => window.TorequeAccountDelete?.open();
  el('cloud-sync').onclick = () => window.TorequeCloud?.sync();
  el('auth-official-refresh').onclick = async () => {
    if (gameBusy() || window.TorequeAccountDelete?.isBusy()) return;
    busy = true; render();
    try { await window.TorequeOfficial.refresh(); }
    catch { /* 正式記録の状態欄で通信失敗を表示します。 */ }
    finally { busy = false; render(); }
  };
  el('cloud-use-local').onclick = () => window.TorequeCloud?.choose('local');
  el('cloud-use-remote').onclick = () => window.TorequeCloud?.choose('cloud');
  el('cloud-decline').onclick = () => window.TorequeCloud?.decline();
  window.TorequeAuth = Object.freeze({ open, ready, getState, refresh: render,
    subscribe(fn) { authListeners.add(fn); return () => authListeners.delete(fn); } });
  render();
})();
