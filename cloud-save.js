/* クラウド同期専用。ローカルを主保存とし、報酬・ゲーム進行は実行しません。 */
(function () {
  'use strict';
  // 古いファイルとの混在を検出。保存先の変更より前に止めます。
  if (typeof TorequeStorage.subscribe !== 'function' || typeof TorequeStorage.switchUser !== 'function' ||
      typeof window.TorequeAuth?.subscribe !== 'function' || typeof window.TorequeAuth?.refresh !== 'function') {
    console.error('[トレクエ] クラウド保存の初期化を停止しました。storage.js / auth.jsを最新版にそろえて再読み込みしてください。');
    window.TorequeAuth?.refresh?.();
    return;
  }
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(sort(value));
  function sort(value) {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
    return value;
  }
  const envelope = save => ({ schemaVersion: 1, save: copy(save) });
  const fingerprint = save => canonical(envelope(save));
  const metaKey = id => `toreque.v1.setup.user.${id}.sync`;
  let owner = null, desired = null, epoch = 0, controller = null, timer = null;
  let queue = Promise.resolve(), row = null, meta = {}, switching = false;
  let state = { status: 'guest', message: '', choice: null, busy: false };
  const listeners = new Set();
  let lastError = null;
  // 診断にはトークン・セーブ内容を含めません。
  const errorText = value => String(value || '').replace(/Bearer\s+\S+|sb_(?:secret|publishable)_\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[非表示]').slice(0, 1000);
  function apiError(result, operation) {
    const detail = { operation, httpStatus: result.status || null,
      code: errorText(result.error?.code), message: errorText(result.error?.message),
      details: errorText(result.error?.details), hint: errorText(result.error?.hint) };
    lastError = detail;
    console.warn('[トレクエ] クラウド保存のAPIエラー', detail);
    const error = new Error(detail.message || 'クラウド通信に失敗しました。');
    error.cloudDetail = detail;
    return error;
  }
  const unsafe = () => TorequeWorkout.isActive() || clearEffectActive;
  const alive = ctx => ctx.epoch === epoch && ctx.id === owner && ctx.id === desired &&
    ctx.id === window.TorequeAuth.getState().userId;
  function show(status, message, choice = null, busy = false) {
    state = { status, message, choice, busy };
    listeners.forEach(fn => { try { fn(); } catch { /* UIの失敗は保存に影響させません。 */ } });
  }
  function persistMeta() {
    try { localStorage.setItem(metaKey(owner), JSON.stringify(meta)); return true; }
    catch { return false; }
  }
  function backup(local, remote) {
    try {
      const key = `toreque.v1.setup.user.${owner}.backup.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, JSON.stringify({ local: copy(local), cloud: copy(remote), savedAt: new Date().toISOString() }));
      return true;
    } catch { show('unsynced', 'バックアップを保存できないため、データの置き換えを止めました。端末の保存容量を確認してください。'); return false; }
  }
  function validSave(save) {
    if (!save || typeof save !== 'object' || Array.isArray(save) || typeof save.completed !== 'boolean' ||
        !save.answers || typeof save.answers !== 'object' || Array.isArray(save.answers)) return false;
    // 形式・安全な表示文字列を検証。未知の旧互換フィールドは削除しません。
    const text = JSON.stringify(save);
    if (text.length > 10000000) return false;
    function safe(value) {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') return !value.includes('<') && !value.includes('>');
      if (!value || typeof value !== 'object') return true;
      return Object.entries(value).every(([key, item]) =>
        !['__proto__', 'constructor', 'prototype', 'password', 'access_token', 'refresh_token', 'service_role', 'secret_key', 'session'].includes(key) && safe(item));
    }
    if (!safe(save)) return false;
    for (const q of QUESTIONS) {
      const answer = save.answers[q.key];
      if (q.key === 'canJump' && answer === undefined) continue; // 旧セーブを維持。
      if (answer === undefined && !save.completed) continue;
      if (!(q.values || q.options).includes(answer)) return false;
    }
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const levels = value => object(value) && Object.values(value).every(n => Number.isInteger(n) && n >= 1 && n <= 5);
    if (save.categoryLevels && !levels(save.categoryLevels)) return false;
    if (save.menus && (!object(save.menus) || !Object.keys(save.menus).every(id => TorequeStages.all.some(s => s.type === 'workout' && String(s.id) === id)))) return false;
    if (save.bossMenus && (!object(save.bossMenus) || !Object.keys(save.bossMenus).every(id => TorequeStages.all.some(s => s.type === 'checkpoint' && s.id === id)))) return false;
    const p = save.progress;
    const stageIds = new Set(TorequeStages.all.map(stage => String(stage.id)));
    if (p) {
      if (typeof p !== 'object' || Array.isArray(p) || !Number.isSafeInteger(p.xp) || p.xp < 0 || p.xp > 1000000000) return false;
      if (p.history && (typeof p.history !== 'object' || Array.isArray(p.history) || !Object.entries(p.history).every(([id, h]) =>
        stageIds.has(id) && h && typeof h === 'object' && !Array.isArray(h) &&
        ['completed', 'rewardClaimed'].every(key => h[key] === undefined || typeof h[key] === 'boolean') &&
        (h.clearCount === undefined || Number.isSafeInteger(h.clearCount) && h.clearCount >= 0) &&
        (h.replayLoadLevel === undefined || Number.isInteger(h.replayLoadLevel) && h.replayLoadLevel >= 0 && h.replayLoadLevel <= TorequeTraining.REPLAY_MAX_LEVEL) &&
        (h.runs === undefined || Array.isArray(h.runs) && h.runs.every(run => run && typeof run.id === 'string' &&
          (!run.result || String(run.result.day) === id && run.result.runId === run.id)))))) return false;
      if (p.pending && (!stageIds.has(String(p.pending.day)) || typeof p.pending.runId !== 'string' ||
        !p.history?.[p.pending.day]?.runs?.some(run => run.id === p.pending.runId))) return false;
    }
    const plans = [save.dayOne, save.dayTwo, ...Object.values(save.menus || {}), ...Object.values(save.bossMenus || {})].filter(Boolean);
    return plans.every(plan => object(plan) && object(plan.profile) && levels(plan.profile.levels) &&
      typeof plan.answerKey === 'string' && Number.isInteger(plan.version) &&
      QUESTIONS[0].options.includes(plan.profile.goal) && QUESTIONS[1].options.includes(plan.profile.focus) &&
      Array.isArray(plan.menu) && plan.menu.length > 0 && plan.menu.length <= 30 &&
      plan.menu.every(e => e && TorequeTraining.catalog.some(item => item.id === e.id) &&
        typeof e.name === 'string' && typeof e.area === 'string' &&
        Number.isFinite(e.value) && e.value > 0 && e.value <= 600 &&
        Number.isInteger(e.sets) && e.sets > 0 && e.sets <= 20 &&
        ['回', '秒'].includes(e.unit) && Number.isFinite(e.restSeconds) && e.restSeconds >= 0 && e.restSeconds <= 600));
  }
  function validRow(value, ctx) {
    return value && value.user_id === ctx.id && typeof value.updated_at === 'string' &&
      Number.isFinite(Date.parse(value.updated_at)) && value.data?.schemaVersion === 1 &&
      Object.keys(value.data).length === 2 && validSave(value.data.save);
  }
  // 読み込み・書き込みを全て同じキューで直列化します。
  function enqueue(job) {
    const ctx = { id: owner, epoch };
    queue = queue.then(async () => {
      if (!ctx.id || !alive(ctx)) return;
      try { await job(ctx); }
      catch (error) {
        if (alive(ctx) && state.status !== 'invalid') {
          const detail = error.cloudDetail;
          const reason = detail ? ` ${detail.operation}: ${detail.code} ${detail.message}` : '';
          show(navigator.onLine === false ? 'offline' : 'unsynced', '未同期です。端末のデータは残っています。' + reason);
        }
      }
    });
    return queue;
  }
  async function request(builder, ctx) {
    if (!alive(ctx)) throw new Error('stale');
    const abort = new AbortController(); controller = abort;
    let timeout;
    try {
      const result = await Promise.race([
        builder.abortSignal(abort.signal),
        new Promise((_, reject) => { timeout = setTimeout(() => { abort.abort(); reject(new Error('timeout')); }, 12000); })
      ]);
      if (!alive(ctx)) throw new Error('stale');
      return result;
    } finally { clearTimeout(timeout); if (controller === abort) controller = null; }
  }
  async function fetchRow(ctx) {
    const result = await request(TorequeSupabase.client.from('user_progress').select('user_id,data,updated_at').eq('user_id', ctx.id).maybeSingle(), ctx);
    if (!alive(ctx)) throw new Error('stale');
    if (result.error) throw apiError(result, 'SELECT'); // 取得エラーは「行なし」ではありません。
    if (result.data && !validRow(result.data, ctx)) {
      show('invalid', 'クラウドデータの形式を確認できません。適用・上書きは行っていません。');
      throw new Error('invalid cloud');
    }
    return result.data;
  }
  function acknowledged(value, sent) {
    row = copy(value); meta.base = canonical(value.data); meta.updatedAt = value.updated_at;
    meta.dirty = fingerprint(TorequeStorage.read()) !== fingerprint(sent); meta.reset = false;
    persistMeta();
    show(meta.dirty ? 'unsynced' : 'synced', meta.dirty ? '新しい端末データを同期します。' : '同期済み');
    if (meta.dirty) schedule();
  }
  function refreshGame() {
    // 適用時は通知なしで保存し、画面だけ初期表示へ戻します。報酬処理は呼びません。
    answers = {}; questionIndex = 0; titleScreen();
  }
  function applyCloud(value) {
    if (unsafe()) { show('attention', '冒険を終了してからクラウドのデータを適用してください。', 'conflict'); return; }
    const previous = TorequeStorage.read();
    if (!backup(previous, value)) return;
    if (!TorequeStorage.save(copy(value.data.save), { notify: false })) {
      show('unsynced', '端末へ保存できません。クラウドデータとバックアップは保持しています。'); return;
    }
    acknowledged(value, value.data.save); refreshGame();
  }
  async function write(local, remote, ctx) {
    const data = envelope(local);
    const table = TorequeSupabase.client.from('user_progress');
    const now = new Date().toISOString();
    const query = remote ? table.update({ data }).eq('user_id', ctx.id).eq('updated_at', remote.updated_at) :
      table.insert({ user_id: ctx.id, data, created_at: now, updated_at: now });
    const result = await request(query.select('user_id,data,updated_at').maybeSingle(), ctx);
    if (!alive(ctx)) throw new Error('stale');
    if (result.error?.code === '23505' || !result.error && !result.data) {
      const latest = await fetchRow(ctx);
      if (!alive(ctx)) return;
      row = latest;
      show('attention', '別の端末でデータが更新されました。使用するデータを確認してください。', row ? 'conflict' : 'upload'); return;
    }
    if (result.error) throw apiError(result, remote ? 'UPDATE' : 'INSERT');
    if (!validRow(result.data, ctx)) throw new Error('invalid response');
    acknowledged(result.data, local);
  }
  async function inspect(ctx) {
    if (navigator.onLine === false) { show('offline', 'オフラインです。端末に保存して冒険を続けられます。'); return; }
    show('syncing', 'クラウドを確認中…', null, true);
    const remote = await fetchRow(ctx);
    if (!alive(ctx)) return;
    row = remote;
    const local = copy(TorequeStorage.read());
    if (local && !validSave(local)) { show('invalid', '端末データの形式を確認できません。データはそのまま保持しています。'); return; }
    if (!row) {
      if (local) {
        if (meta.approved && !meta.base && !meta.reset) await write(local, null, ctx);
        else show('attention', 'このアカウントにクラウドセーブはありません。端末のデータを保存しますか？', 'upload');
      } else if (!meta.guestDeclined && TorequeStorage.readForUser()) {
        show('attention', 'この端末の冒険データをアカウントへ引き継ぎますか？元の未ログインデータは残ります。', 'inherit');
      } else {
        meta.approved = true; persistMeta();
        show('unsynced', '新しい冒険を始めると、端末への保存後にクラウドへ同期します。');
      }
      return;
    }
    if (!local && !meta.reset) { applyCloud(row); return; }
    if (local && fingerprint(local) === canonical(row.data)) { acknowledged(row, local); return; }
    if (!meta.reset && meta.dirty && meta.base === canonical(row.data)) { await write(local, row, ctx); return; }
    show('attention', '端末とクラウドのデータが異なります。使用するデータを選んでください。自動合算はしません。', 'conflict');
  }
  function schedule() {
    clearTimeout(timer);
    if (!owner || owner !== desired || ['attention', 'invalid', 'deferred'].includes(state.status)) return;
    timer = setTimeout(() => { timer = null; sync(); }, 350);
  }
  function sync() {
    if (desired !== owner) { activate(); return queue; }
    return enqueue(inspect);
  }
  function choose(which) {
    const expectedRow = copy(row), source = state.choice === 'inherit' ? 'guest' : 'user';
    const selected = copy(source === 'guest' ? TorequeStorage.readForUser() : TorequeStorage.read());
    const expectedLocal = fingerprint(TorequeStorage.read());
    return enqueue(async ctx => {
      if (unsafe()) { show('attention', 'トレーニング・演出を終了してから選択してください。', state.choice); return; }
      show('syncing', '選択したデータを確認中…', null, true);
      const latest = await fetchRow(ctx);
      if (!alive(ctx)) return;
      const changed = canonical(latest) !== canonical(expectedRow) || fingerprint(TorequeStorage.read()) !== expectedLocal ||
        source === 'guest' && fingerprint(TorequeStorage.readForUser()) !== fingerprint(selected);
      if (changed) { row = latest; show('attention', '確認中にデータが変わりました。もう一度選択してください。', latest ? 'conflict' : source === 'guest' ? 'inherit' : 'upload'); return; }
      if (which === 'cloud') {
        if (latest) applyCloud(latest);
        return;
      }
      if (!validSave(selected)) { show('invalid', '選択した端末データの形式を確認できません。上書きしていません。'); return; }
      if (!backup(TorequeStorage.read(), latest)) return;
      if (source === 'guest') {
        if (!TorequeStorage.save(selected, { notify: false })) { show('unsynced', '端末へ保存できないため引き継ぎを止めました。元データは残っています。'); return; }
        refreshGame();
      }
      meta.approved = true; meta.guestDeclined = true; meta.base = latest ? canonical(latest.data) : null;
      meta.updatedAt = latest?.updated_at || null; meta.dirty = true; meta.reset = false; persistMeta();
      await write(selected, latest, ctx);
    });
  }
  function decline() {
    if (state.choice !== 'inherit' || state.busy || unsafe()) return;
    meta.guestDeclined = true; meta.approved = true; persistMeta();
    show('unsynced', '元の未ログインデータは残っています。このアカウントで新しい冒険を始められます。');
    refreshGame();
  }
  function activate() {
    if (unsafe()) { show('deferred', 'トレーニング・演出を終了してから「今すぐ同期」を押すと、アカウントの保存先へ切り替わります。'); return; }
    owner = desired; TorequeStorage.switchUser(owner); row = null;
    try { meta = JSON.parse(localStorage.getItem(metaKey(owner))) || {}; } catch { meta = {}; }
    if (owner) show('syncing', 'クラウドを確認中…', null, true);
    else show('guest', '未ログイン用の冒険に戻りました。');
    refreshGame();
    if (owner) enqueue(inspect);
  }
  function changeUser(auth) {
    const id = auth.userId || null;
    if (id === desired) return;
    desired = id; epoch++; controller?.abort(); clearTimeout(timer); timer = null;
    // Authイベントのコールバック内ではSDK APIを呼びません。
    setTimeout(activate, 0);
  }
  function onScreenChange() {
    if (owner === desired || switching || unsafe()) return;
    switching = true;
    setTimeout(() => { switching = false; if (owner !== desired) activate(); }, 0);
  }
  // Console用の読み取り専用診断。セーブの適用・アップロードは行いません。
  async function checkAccess() {
    await TorequeSupabase.ready;
    const client = TorequeSupabase.client;
    if (!client) return { ok: false, message: 'Supabase Clientを利用できません。' };
    try {
      const sessionResult = await client.auth.getSession();
      const session = sessionResult.data?.session;
      const authUserId = window.TorequeAuth.getState().userId;
      const identity = { sessionUserId: session?.user?.id || null, authUserId,
        userIdMatches: !!session && session.user.id === authUserId,
        hasAccessToken: !!session?.access_token };
      if (sessionResult.error || !identity.userIdMatches || !identity.hasAccessToken)
        return { ok: false, ...identity, message: '認証セッションを確認してください。再ログインが必要な可能性があります。' };
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 12000);
      try {
        // SDKがこの同じClientのセッションからAuthorizationを付与します。
        const result = await client.from('user_progress').select('user_id')
          .eq('user_id', session.user.id).maybeSingle().abortSignal(abort.signal);
        return { ok: !result.error, ...identity, operation: 'SELECT', httpStatus: result.status || null,
          rowExists: !!result.data, error: result.error ? apiError(result, 'SELECT').cloudDetail : null };
      } finally { clearTimeout(timeout); }
    } catch (error) { return { ok: false, message: errorText(error.message) }; }
  }
  TorequeStorage.subscribe(event => {
    if (!event.userId || event.userId !== owner) return;
    meta.dirty = true;
    if (event.type === 'reset') {
      epoch++; controller?.abort(); clearTimeout(timer); timer = null;
      backup(event.data, row); meta.reset = true; persistMeta();
      show('attention', '端末の初期設定をリセットしました。クラウドは変更していません。', row ? 'conflict' : 'upload'); return;
    }
    persistMeta();
    if (state.status === 'synced') show('unsynced', '端末に保存しました。クラウドへ同期します。');
    schedule();
  });
  // 同一アカウントの別タブの変更も、古いデータで自動上書きしません。
  window.addEventListener('storage', event => {
    if (owner && (event.key === TorequeStorage.getKey() || event.key === metaKey(owner))) {
      epoch++; controller?.abort(); clearTimeout(timer);
      try { meta = JSON.parse(localStorage.getItem(metaKey(owner))) || {}; } catch { meta = {}; }
      show('attention', '別のタブでデータが変わりました。冒険を終了して「今すぐ同期」で確認してください。', 'conflict');
    }
  });
  window.addEventListener('offline', () => { controller?.abort(); if (owner) show('offline', 'オフラインです。端末のデータを保持しています。'); });
  window.addEventListener('online', () => { if (owner && owner === desired) sync(); });
  window.TorequeCloud = Object.freeze({
    sync, choose, decline, onScreenChange, validSave, checkAccess,
    getLastError: () => copy(lastError),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState() {
      if (owner !== desired) return { status: 'deferred', message: 'トレーニング・演出を終了してから保存先を切り替えます。', choice: null, busy: false, userId: desired, local: null, cloud: null };
      return { ...state, userId: desired, local: copy(state.choice === 'inherit' ? TorequeStorage.readForUser() : TorequeStorage.read()), cloud: copy(row?.data.save || null) };
    }
  });
  window.TorequeAuth.subscribe(changeUser);
  window.TorequeCloud.subscribe(() => window.TorequeAuth.refresh());
  window.TorequeAuth.refresh(); // 先にログインが復元されていても、モジュール準備をUIへ反映。
  window.TorequeAuth.ready.then(() => changeUser(window.TorequeAuth.getState()));
})();
