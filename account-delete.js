/* 本人による削除。成功応答を受け取るまで端末データを保持します。 */
(function () {
  'use strict';
  let busy = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'exercise-dialog account-delete-dialog';
  dialog.innerHTML = `<h2>アカウントを削除しますか？</h2><p>アカウント、クラウドの冒険データ、このブラウザのアカウント専用データを削除します。元に戻せません。未ログインの冒険と端末設定は残ります。</p><form id="delete-form"><label>現在のパスワード<input id="delete-password" type="password" autocomplete="current-password" required></label><label><input id="delete-agree" type="checkbox" required> 削除内容を理解しました</label><button class="primary" type="submit">完全に削除する</button></form><p id="delete-message" role="status"></p><button class="secondary" id="delete-cancel">キャンセル</button>`;
  document.body.appendChild(dialog);
  const el = id => dialog.querySelector('#' + id);
  function render() {
    dialog.querySelectorAll('input,button').forEach(e => { e.disabled = busy; });
    window.TorequeAuth.refresh();
  }
  async function clean(id) {
    TorequeCloud.pauseDeletion();
    TorequeStorage.finishDeletion(id);
    // 応答待ち中に別タブで別ユーザーへ切り替わった場合、そのセッションには触れない。
    if (TorequeAuth.getState().userId !== id) { dialog.close(); return; }
    TorequeWorkout.cancel();
    try { await TorequeSupabase.client.auth.signOut({ scope: 'local' }); } catch { /* 下で本人の端末セッションも整理 */ }
    const ref = new URL(TorequeSupabaseConfig.projectUrl).hostname.split('.')[0];
    const key = `sb-${ref}-auth-token`;
    let savedSession;
    try { savedSession = JSON.parse(localStorage.getItem(key)); } catch { /* 他のデータを誤削除しない */ }
    if (savedSession?.user?.id === id) {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}-code-verifier`);
    }
    const now = TorequeAuth.getState().userId;
    if (!now || now === id) location.reload();
    else dialog.close();
  }
  el('delete-cancel').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.onclose = () => { el('delete-password').value = ''; el('delete-agree').checked = false; };
  el('delete-form').onsubmit = async event => {
    event.preventDefault();
    if (busy || !el('delete-form').reportValidity() || TorequeWorkout.isActive() || clearEffectActive) return;
    const user = TorequeAuth.getState();
    if (!user.loggedIn) return;
    busy = true; render();
    let started = false, confirmed = false;
    try {
      const client = TorequeSupabase.client;
      const auth = await client.auth.signInWithPassword({ email: user.email, password: el('delete-password').value });
      if (auth.error || auth.data.user?.id !== user.userId || !auth.data.session?.access_token) {
        el('delete-message').textContent = '本人確認に失敗しました。パスワードとログイン状態を確認してください。'; return;
      }
      TorequeStorage.beginDeletion(user.userId); started = true;
      TorequeCloud.pauseDeletion();
      el('delete-message').textContent = '削除しています。画面を閉じずにお待ちください。';
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 20000);
      let response, result;
      try {
        response = await fetch(TorequeSupabaseConfig.projectUrl + '/functions/v1/delete-account', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: TorequeSupabaseConfig.publishableKey,
            Authorization: 'Bearer ' + auth.data.session.access_token },
          body: JSON.stringify({ password: el('delete-password').value, confirm: true }), signal: abort.signal
        });
        result = await response.json();
      } finally { clearTimeout(timeout); }
      if (response.ok && result.ok === true && result.deletedUserId === user.userId) {
        confirmed = true; await clean(user.userId); return;
      }
      // Functionの明示的な拒否だけは削除していないことが分かる。
      if (result.ok === false && result.deleted === false) {
        TorequeStorage.cancelDeletion(user.userId); TorequeCloud.sync();
        el('delete-message').textContent = '削除できませんでした。本人確認・Functionの設定を確認してください。データは保持しています。';
      } else throw new Error('uncertain');
    } catch {
      el('delete-message').textContent = confirmed
        ? 'アカウント削除は完了しましたが、端末の整理を完了できませんでした。ページを再読み込みしてください。'
        : started ? '削除結果を確認できません。端末データを保持し、同期を停止しています。再試行するか管理者へ確認してください。'
        : '通信できませんでした。端末データは保持しています。';
    } finally { el('delete-password').value = ''; busy = false; render(); }
  };
  window.addEventListener('storage', event => {
    const id = TorequeAuth.getState().userId;
    if (id && event.key === `toreque.account-delete.${id}` && event.newValue === 'deleted') {
      clean(id).catch(() => { location.reload(); });
    }
  });
  window.TorequeAccountDelete = Object.freeze({ isBusy: () => busy,
    open() {
      if (busy || !TorequeAuth.getState().loggedIn || TorequeWorkout.isActive() || clearEffectActive) return;
      el('delete-message').textContent = ''; render(); if (!dialog.open) dialog.showModal();
    }
  });
  // 成功後に端末整理が中断された場合も、次回起動時に完了する。
  TorequeAuth.ready.then(() => {
    const id = TorequeAuth.getState().userId;
    if (id && TorequeStorage.deletionState(id) === 'deleted') clean(id).catch(() => {});
    TorequeAuth.refresh();
  });
})();
