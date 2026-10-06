/* ログイン中の正式成果。ローカル・user_progressの成果は読み込みません。 */
(function () {
  'use strict';
  const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = TorequeStages.all.map(s => String(s.id));
  let owner = null, epoch = 0, queue = Promise.resolve(), controller = null;
  let snapshot = null, runs = [], status = 'guest', message = '', fetching = null;
  let plans = { menus: {}, bossMenus: {} }, answerKey = null;
  let navigationRevision = 0, navigationPending = 0;
  const listeners = new Set();
  function managed() {
    const auth = window.TorequeAuth?.getState();
    return !!(auth?.userId || auth?.initializing);
  }
  function notify() { listeners.forEach(fn => { try { fn(); } catch { /* 表示失敗は成果を変更しません。 */ } }); }
  function ready() { return !!owner && owner === window.TorequeAuth.getState().userId && status === 'ready' && !TorequeStorage.deletionState(owner); }
  function alive(ctx) { return !!ctx.owner && ctx.epoch === epoch && ctx.owner === owner && owner === window.TorequeAuth.getState().userId && !TorequeStorage.deletionState(owner); }
  function failure(code, text) { const error = new Error(text); error.code = code; return error; }
  function validate(value) {
    if (!value || !Number.isSafeInteger(value.totalXp) || value.totalXp < 0 || !Number.isSafeInteger(value.revision) ||
        !Number.isInteger(value.level) || value.level < 1 || !Number.isSafeInteger(value.levelXp) || value.levelXp < 0 ||
        value.requiredXp !== 500 + (value.level - 1) * 250 || value.levelXp >= value.requiredXp ||
        !Number.isInteger(value.streak) || value.streak < 0 || !value.stages || !Array.isArray(value.unlockedStages) ||
        !value.unlockedStages.every(id => ids.includes(String(id)))) throw failure('invalid_response', '正式記録の形式を確認できません。');
    for (const id of ids) {
      const stage = value.stages[id];
      if (!stage || !Number.isSafeInteger(stage.clearCount) || stage.clearCount < 0 || stage.completed !== (stage.clearCount > 0) ||
          !Number.isInteger(stage.replayLoadLevel) || stage.replayLoadLevel < 0 || stage.replayLoadLevel > 3)
        throw failure('invalid_response', '正式なステージ記録を確認できません。');
    }
    if (value.openRun && (value.openRun.user_id !== owner || !uuid.test(value.openRun.run_id) ||
        !ids.includes(value.openRun.stage_id) || !['active', 'completed'].includes(value.openRun.status)))
      throw failure('invalid_response', '実行中の記録を確認できません。');
    return value;
  }
  async function bounded(job, ctx) {
    if (!alive(ctx)) throw failure('stale', 'アカウントが変わりました。');
    const abort = new AbortController(); controller = abort;
    let timeout;
    try {
      const result = await Promise.race([job(abort.signal), new Promise((_, reject) => {
        timeout = setTimeout(() => { abort.abort(); reject(failure('network', '通信結果を確認できません。同じ記録で再試行してください。')); }, 15000);
      })]);
      if (!alive(ctx)) throw failure('stale', 'アカウントが変わりました。');
      return result;
    } finally { clearTimeout(timeout); if (controller === abort) controller = null; }
  }
  async function invoke(body, ctx) {
    const client = window.TorequeSupabase.client;
    if (!client) throw failure('unavailable', 'Supabaseに接続できません。');
    return bounded(async signal => {
      const auth = await client.auth.getSession();
      if (auth.error || auth.data?.session?.user?.id !== ctx.owner || !auth.data?.session?.access_token)
        throw failure('unauthorized', 'ログイン状態を確認してください。');
      if (!alive(ctx)) throw failure('stale', 'アカウントが変わりました。');
      const result = await client.functions.invoke('workout-progress', {
        body, headers: { Authorization: 'Bearer ' + auth.data.session.access_token }, signal
      });
      let data = result.data;
      if (result.error) {
        try { data = await result.error.context?.json(); } catch { /* トークンや生のエラーを表示しません。 */ }
        throw failure(data?.code || 'network', data?.message || '正式記録を確認できません。通信環境を確認して再試行してください。');
      }
      if (data?.ok !== true) throw failure('invalid_response', '正式記録を取得できません。');
      validate(data.achievements);
      if (body.action !== 'get' && (!data.run || data.run.user_id !== ctx.owner || !uuid.test(data.run.run_id) ||
          !ids.includes(data.run.stage_id) || body.runId && data.run.run_id !== body.runId ||
          body.stageId && data.run.stage_id !== body.stageId))
        throw failure('invalid_response', '本人の実行記録を確認できません。');
      return data;
    }, ctx);
  }
  // 本人SELECTだけ。DB関数・正式テーブルの更新は一切行いません。
  async function history(ctx) {
    const result = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await bounded(signal => window.TorequeSupabase.client.from('workout_runs')
        .select('run_id,user_id,stage_id,status,started_at,completed_at,training_day,clear_no,reward_xp,total_xp_after,rating,rated_at')
        .eq('user_id', ctx.owner).eq('status', 'completed').order('completed_at').order('run_id')
        .range(offset, offset + 999).abortSignal(signal), ctx);
      if (page.error || !Array.isArray(page.data)) throw failure('history_unavailable', '正式な評価履歴を取得できません。再試行してください。');
      for (const row of page.data) {
        if (row.user_id !== ctx.owner || !ids.includes(row.stage_id) || !uuid.test(row.run_id) || row.status !== 'completed' ||
            !Number.isFinite(Date.parse(row.started_at)) || !Number.isFinite(Date.parse(row.completed_at)) || !Number.isSafeInteger(row.clear_no) || row.clear_no < 1 ||
            !Number.isSafeInteger(row.total_xp_after) || ![50,75,100,150,300].includes(row.reward_xp) ||
            !(row.rating === null || TorequeProgress.RATINGS.includes(row.rating) && Number.isFinite(Date.parse(row.rated_at))))
          throw failure('invalid_response', '正式な評価履歴の形式を確認できません。');
        result.push(row);
      }
      if (page.data.length < 1000) break;
    }
    return result;
  }
  async function load(ctx, initial = null) {
    let response = initial || await invoke({ action: 'get' }, ctx);
    // 別タブで完了・評価が行われた場合、異なるrevisionの履歴を混ぜません。
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = await history(ctx), check = await invoke({ action: 'get' }, ctx);
      if (response.achievements.revision === check.achievements.revision) {
        if (new Set(rows.map(r => r.run_id)).size !== rows.length || ids.some(id => {
          const stageRows = rows.filter(r => r.stage_id === id);
          return stageRows.length !== check.achievements.stages[id].clearCount ||
            new Set(stageRows.map(r => r.clear_no)).size !== stageRows.length;
        })) throw failure('history_incomplete', '正式な評価履歴をすべて取得できません。端末の履歴は代用しません。');
        snapshot = clone(check.achievements); runs = clone(rows); status = 'ready'; message = ''; notify(); return response;
      }
      response = check;
    }
    throw failure('changed', '別の端末で正式記録が更新されました。再確認してください。');
  }
  function enqueue(job) {
    const ctx = { owner, epoch };
    const result = queue.catch(() => {}).then(async () => {
      if (!alive(ctx)) throw failure('stale', 'アカウントが変わりました。');
      try { return await job(ctx); }
      catch (error) {
        if (alive(ctx)) { status = 'error'; message = error.message; notify(); }
        throw error;
      }
    });
    queue = result.catch(() => {});
    return result;
  }
  function refresh() {
    if (fetching) return fetching;
    status = 'loading'; message = '正式な記録を確認中…'; notify();
    const token = epoch;
    fetching = enqueue(ctx => load(ctx)).finally(() => { if (token === epoch) fetching = null; });
    return fetching;
  }
  function resultFor(run, data = snapshot) {
    if (!run || !data) return null;
    const day = /^\d+$/.test(run.stage_id) ? Number(run.stage_id) : run.stage_id;
    const next = run.clear_no === 1 ? TorequeStages.next(day) : null;
    const state = TorequeProgress.levelState(run.total_xp_after);
    return { day, runId: run.run_id, firstClear: run.clear_no === 1, clearCount: run.clear_no,
      reward: run.reward_xp, xp: run.total_xp_after, ...state,
      previousLevel: TorequeProgress.levelFor(run.total_xp_after - run.reward_xp),
      unlockedStage: next?.id || null, unlockedDay: next?.type === 'workout' ? next.id : null };
  }
  function read() {
    if (!ready()) return { xp: 0, level: 1, levelXp: 0, requiredXp: 500, streak: 0,
      lastTrainingDate: null, history: {}, unlockedStages: [], unlockedDays: [], unlockedExercises: [], pending: null };
    const history = {};
    for (const id of ids) {
      const s = snapshot.stages[id], rows = runs.filter(r => r.stage_id === id);
      history[id] = { completed: s.completed, rewardClaimed: s.completed, clearCount: s.clearCount,
        replayLoadLevel: s.replayLoadLevel, firstClearAt: rows[0]?.completed_at || null, completedAt: rows.at(-1)?.completed_at || null,
        firstRating: rows.find(r => r.rating)?.rating || null, rating: [...rows].reverse().find(r => r.rating)?.rating || null,
        runs: rows.map(r => ({ id: r.run_id, completedAt: r.completed_at, rating: r.rating, result: resultFor(r) })) };
    }
    const unlockedStages = snapshot.unlockedStages.map(id => /^\d+$/.test(String(id)) ? Number(id) : id);
    return { xp: snapshot.totalXp, level: snapshot.level, levelXp: snapshot.levelXp, requiredXp: snapshot.requiredXp,
      streak: snapshot.streak, lastTrainingDate: snapshot.lastTrainingDay, history, unlockedStages,
      unlockedDays: unlockedStages.filter(id => typeof id === 'number'),
      unlockedExercises: TorequeTraining.catalog.filter(e => e.requiredCheckpoint && history[e.requiredCheckpoint]?.completed).map(e => e.id),
      pending: snapshot.openRun?.status === 'completed' ? resultFor(snapshot.openRun) : null };
  }
  function setup(raw) {
    if (!raw) return raw;
    const key = JSON.stringify(raw.answers);
    if (answerKey !== key) { answerKey = key; plans = { menus: {}, bossMenus: {} }; }
    const levels = raw.categoryLevels || TorequeTraining.profileFrom(raw.answers || {}).levels;
    return { ...raw, progress: read(), dayOne: plans.dayOne, dayTwo: plans.dayTwo,
      menus: clone(plans.menus), bossMenus: clone(plans.bossMenus), categoryLevels: levels };
  }
  function remember(id, plan) {
    if (id === 1) plans.dayOne = clone(plan);
    else if (typeof id === 'number') plans.menus[id] = clone(plan);
    else plans.bossMenus[id] = clone(plan);
    return plan;
  }
  function cutoff(id) {
    const first = runs.find(r => r.stage_id === String(id) && r.clear_no === 1);
    const active = snapshot?.openRun?.stage_id === String(id) ? snapshot.openRun : null;
    return first?.started_at || active?.started_at || null;
  }
  function checkpointsFor(id) {
    const limit = cutoff(id);
    return ids.filter(key => key.startsWith('checkpoint') && snapshot?.stages[key].completed &&
      (!limit || runs.some(r => r.stage_id === key && r.clear_no === 1 && Date.parse(r.completed_at) <= Date.parse(limit))));
  }
  function feedback(id = null) {
    // 再読み込みで過去DAYの基準メニューを再構築するとき、未来の評価を何段も重ねない。
    const limit = id === null ? null : cutoff(id);
    return runs.filter(r => r.rating && (!limit || Date.parse(r.rated_at) <= Date.parse(limit))).map((r, order) => {
      const day = /^\d+$/.test(r.stage_id) ? Number(r.stage_id) : r.stage_id;
      const plan = typeof day === 'number' ? day === 1 ? plans.dayOne : plans.menus[day] : plans.bossMenus[day];
      return { day, rating: r.rating, completedAt: r.completed_at, order, time: Date.parse(r.completed_at), menu: clone(plan?.menu || []) };
    });
  }
  async function mutate(body) {
    return enqueue(async ctx => {
      const response = await invoke(body, ctx);
      await load(ctx, response);
      return response;
    });
  }
  function state() { return { status, message, ready: ready(), userId: owner, openRun: clone(snapshot?.openRun) }; }
  function showRecovery() {
    const token = epoch;
    screen('<section class="course-screen"><h1>正式な記録を確認</h1><p id="official-message"></p><button class="primary" id="official-retry">記録を再確認</button><button class="secondary" id="official-account">アカウント</button></section>');
    document.getElementById('official-message').textContent = message || '正式な記録を確認中です。通信失敗時に端末の成果を代用しません。';
    document.getElementById('official-retry').onclick = async () => {
      if (token !== epoch) return;
      const button = document.getElementById('official-retry'); button.disabled = true;
      try { await refresh(); if (token !== epoch) return; if (readSetup()) homeScreen(); else titleScreen(); }
      catch { if (token === epoch) showRecovery(); }
    };
    document.getElementById('official-account').onclick = () => window.TorequeAuth.open();
  }
  function recoverActive() {
    const run = snapshot?.openRun;
    const token = epoch;
    if (!ready() || run?.status !== 'active') return false;
    screen('<section class="course-screen"><h1>前回のトレーニング</h1><p id="official-stage"></p><p>途中のSETは保存していません。最初のSETから再開できます。</p><button class="primary" id="official-resume">このトレーニングを再開</button><button class="secondary" id="official-abandon">中断してホームへ</button><p id="official-error" role="status"></p></section>');
    document.getElementById('official-stage').textContent = TorequeStages.get(run.stage_id)?.label || run.stage_id;
    document.getElementById('official-resume').onclick = () => { if (token !== epoch) return; const id = /^\d+$/.test(run.stage_id) ? Number(run.stage_id) : run.stage_id; TorequeWorkout.start(getPlayablePlan(id).menu, id); };
    document.getElementById('official-abandon').onclick = async () => {
      if (token !== epoch) return;
      document.getElementById('official-abandon').disabled = true;
      try { await mutate({ action: 'abandon', runId: run.run_id }); if (token === epoch) homeScreen(); }
      catch (error) { if (token === epoch) { document.getElementById('official-error').textContent = error.message; document.getElementById('official-abandon').disabled = false; } }
    };
    return true;
  }
  function invalidate() { epoch++; controller?.abort(); controller = null; fetching = null; snapshot = null; runs = []; plans = { menus: {}, bossMenus: {} }; answerKey = null; }
  function pauseDeletion() { invalidate(); status = 'error'; message = 'アカウント削除のため正式記録の通信を停止しています。'; notify(); }
  // 取得後もクリックの遷移先を保持する。起動時の自動描画よりユーザー操作を優先。
  async function navigateReady(next) {
    navigationRevision++; navigationPending++;
    const identity = window.TorequeAuth.getState().userId;
    try {
      await window.TorequeAuth.ready;
      const auth = window.TorequeAuth.getState();
      if (identity && identity !== auth.userId) return;
      changeUser(auth);
      const token = epoch, id = owner;
      if (id && !ready()) await refresh();
      if (token !== epoch || id !== window.TorequeAuth.getState().userId) return;
      if (id && !ready()) throw failure('not_ready', '正式記録を確認できません。もう一度お試しください。');
      next();
    } finally { navigationPending--; }
  }
  function changeUser(auth) {
    const id = auth.userId || null;
    if (id === owner) return;
    invalidate(); owner = id; status = id ? 'loading' : 'guest'; message = ''; notify();
    // Auth SDKのコールバック内でSDKを呼ばない。
    const token = epoch;
    const navigation = navigationRevision, skipInitialScreen = navigationPending > 0;
    setTimeout(async () => {
      if (token !== epoch) return;
      TorequeWorkout.cancel(); cancelClearEffect();
      if (!id) return;
      try { await refresh(); if (token === epoch && navigation === navigationRevision && !skipInitialScreen && !navigationPending && !TorequeWorkout.isActive()) titleScreen(); }
      catch { if (token === epoch && navigation === navigationRevision && !skipInitialScreen && !navigationPending) showRecovery(); }
    }, 0);
  }
  window.TorequeOfficial = Object.freeze({ managed, ready, read, setup, remember, feedback, checkpointsFor, refresh, getState: state, pauseDeletion,
    showRecovery, recoverActive, resultFor, navigateReady,
    start: async id => { if (!ready()) throw failure('not_ready', '正式記録を再確認してください。'); const r = await mutate({ action: 'start', stageId: String(id) }); return clone(r.run); },
    complete: async runId => { const r = await mutate({ action: 'complete', runId }); return resultFor(r.run); },
    rate: async (runId, rating) => { await mutate({ action: 'rate', runId, rating }); return true; },
    abandon: runId => mutate({ action: 'abandon', runId }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  });
  window.TorequeAuth.subscribe(changeUser);
  listeners.add(() => window.TorequeAuth.refresh());
  window.TorequeAuth.ready.then(() => changeUser(window.TorequeAuth.getState()));
  window.addEventListener('storage', event => { if (owner && event.key === `toreque.account-delete.${owner}`) { invalidate(); status = 'error'; message = 'アカウント削除のため記録通信を停止しています。'; notify(); } });
  window.addEventListener('online', () => { if (owner && status === 'error') refresh().catch(() => {}); });
})();
