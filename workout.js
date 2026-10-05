/* 自動進行を1本のタイマーで管理。保存済みメニューは変更しません。 */
const TorequeWorkout = (() => {
  let session = null, timerId, deadline = 0, running = false, generation = 0;
  let runSequence = 0;
  const current = () => session.menu[session.index];
  function stopTimer() {
    if (running && session) session.remainingMs = Math.max(0, deadline - Date.now());
    clearTimeout(timerId); timerId = undefined; running = false; generation++;
    TorequeSound.silence();
  }
  function cancel() { stopTimer(); session = null; }
  function start(menu, day = 1) {
    cancel(); TorequeSound.unlock();
    if (!TorequeProgress.read().unlockedStages.includes(day) || !Array.isArray(menu) || !menu.length) { homeScreen(); return; }
    session = { menu: menu.map(e => ({ ...e })), stage: stageInfo(day),
      runId: `${day}-${Date.now()}-${++runSequence}-${Math.random().toString(36).slice(2)}`,
      index: 0, set: 1, side: 1,
      phase: '', remainingMs: null, completedSets: 0, paused: false, modalDepth: 0, lastCount: null };
    prepareSet();
  }
  function enter(phase, milliseconds = null, cue = false) {
    stopTimer(); session.phase = phase; session.remainingMs = milliseconds; session.lastCount = null;
    if (phase === 'complete' && !session.result) session.result = TorequeProgress.complete(session.stage.day, session.runId, new Date(),
      { sets: session.completedSets, exercises: session.menu.length, exerciseIds: session.menu.map(e => e.id) });
    render(); if (cue) TorequeSound.play('signal'); schedule();
  }
  // DEV ONLY：実行を省略し、通常のenter('complete')で報酬・記録・評価へ進みます。
  function devComplete(runId) {
    if (!DEV_MODE || !session || session.runId !== runId || session.result ||
        ['complete', 'rewards'].includes(session.phase) || session.modalDepth) return;
    session.completedSets = session.menu.reduce((sum, exercise) => sum + exercise.sets, 0);
    session.paused = false;
    enter('complete'); // 既存のタイマー・効果音cleanupもここで実行。
  }
  function restoreCompletion(result) {
    cancel();
    session = { menu: [], stage: stageInfo(result.day), runId: result.runId, index: 0,
      phase: 'complete', remainingMs: null, completedSets: 0, paused: false, modalDepth: 0, result };
    render();
  }
  function prepareSet() {
    session.side = 1;
    if (current().unit === '秒') enter('ready', 2000); else enter('set');
  }
  function schedule() {
    if (!session || session.paused || session.modalDepth || running || session.remainingMs === null) return;
    running = true; deadline = Date.now() + session.remainingMs;
    const token = ++generation;
    const tick = () => {
      if (!session || !running || token !== generation) return;
      session.remainingMs = Math.max(0, deadline - Date.now());
      const seconds = Math.ceil(session.remainingMs / 1000);
      const counter = document.getElementById('countdown');
      if (counter) counter.textContent = seconds;
      if (['countin', 'set', 'rest', 'exerciseRest'].includes(session.phase) && seconds >= 1 && seconds <= 3 && session.lastCount !== seconds) {
        session.lastCount = seconds; TorequeSound.play('count');
        if (session.phase === 'countin' && counter) { counter.classList.remove('count-pop'); void counter.offsetWidth; counter.classList.add('count-pop'); }
      }
      if (session.remainingMs === 0) { advance(); return; }
      // 秒の境界にも合わせ、停止・再開後の表示と音がずれないようにします。
      const untilNextSecond = session.remainingMs % 1000 || 1000;
      timerId = setTimeout(tick, Math.min(100, session.remainingMs, untilNextSecond));
    };
    tick();
  }
  function advance() {
    if (!session) return;
    const phase = session.phase;
    if (phase === 'ready') enter('countin', 3000);
    else if (phase === 'countin') enter('start', 500, true);
    else if (phase === 'start') enter('set', current().value * 1000);
    else if (phase === 'set') enter('setclear', 900, true);
    else if (phase === 'setclear') {
      if (session.side < (current().sides || 1)) { session.side++; enter('ready', 2000); }
      else finishSet();
    } else if (phase === 'rest') enter('restclear', 2300, true);
    else if (phase === 'restclear') { session.set++; prepareSet(); }
    else if (phase === 'clear') {
      if (session.index < session.menu.length - 1) enter('exerciseRest', 45000); else enter('complete');
    } else if (phase === 'exerciseRest') {
      session.index++; session.set = 1; prepareSet(); TorequeSound.play('signal');
    }
  }
  function finishSet() {
    session.completedSets++;
    if (session.set < current().sets) enter('rest', current().restSeconds * 1000);
    else enter('clear', 1500);
  }
  function completeReps() {
    if (!session || session.phase !== 'set' || current().unit !== '回' || session.paused || session.modalDepth) return;
    finishSet(); TorequeSound.play('signal');
  }
  function togglePause() {
    if (!session || session.modalDepth) return;
    if (!session.paused) { stopTimer(); session.paused = true; }
    else { session.paused = false; TorequeSound.unlock(); }
    render(); schedule();
  }
  // モーダルが重なっても、全部閉じるまで再開しません。
  function suspendForModal() {
    if (!session) return () => {};
    const owner = session; stopTimer(); owner.modalDepth++;
    let closed = false;
    return () => {
      if (closed || session !== owner) return;
      closed = true; owner.modalDepth = Math.max(0, owner.modalDepth - 1); schedule();
    };
  }
  // 以下は表示専用。タイマーやセット進行の状態には書き込みません。
  function progressHtml() {
    if (['complete', 'rewards'].includes(session.phase)) return `<div class="eyebrow completion-day">${session.stage.label}</div>`;
    const done = session.index + (session.phase === 'clear' || session.phase === 'exerciseRest' ? 1 : 0);
    const hp = Math.round((1 - done / session.menu.length) * 100);
    const boss = session.stage.type === 'checkpoint' ? `<div class="battle-banner"><img src="images/${session.stage.bossImage}" alt="${session.stage.bossName}"><div><span class="eyebrow">BOSS BATTLE</span><strong>${session.stage.bossName}</strong><span>BOSS HP ${hp}%</span><div class="boss-hp" role="progressbar" aria-label="ボスのHP（演出）" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hp}"><i style="width:${hp}%"></i></div></div></div>` : '';
    return `<div class="workout-top"><button class="exit-workout" id="workout-exit" aria-label="トレーニングを終了する">← 終了</button><span>${session.stage.label}</span><strong>${session.index + 1} / ${session.menu.length}<small>EXERCISES</small></strong></div><div class="progress" role="progressbar" aria-label="完了した種目の進捗" aria-valuemin="0" aria-valuemax="${session.menu.length}" aria-valuenow="${done}"><span style="width:${done / session.menu.length * 100}%"></span></div>${boss}`;
  }
  function setDisplay(e, next = false) {
    const active = session.set + (next ? 1 : 0);
    return `<div class="set-display"><p class="set-label">SET ${active} / ${e.sets}</p><div class="set-dots" aria-hidden="true">${Array.from({length:e.sets},(_,i) => `<span class="${i < active - 1 ? 'done' : i === active - 1 ? 'now' : ''}">${i < active - 1 ? '✓' : ''}</span>`).join('')}</div></div>`;
  }
  function exerciseVisual(e) {
    // 将来の画像は exercise.image = 'images/exercises/pushup.png' のように指定。
    const localImage = typeof e.image === 'string' && /^images\/[a-zA-Z0-9_./-]+$/.test(e.image) && !e.image.includes('..');
    const parts = {upper:'<path d="M30 30H62V44H30Z"/>',legs:'<path d="M33 55H43V86H33ZM49 55H59V86H49Z"/>',core:'<path d="M34 43H58V59H34Z"/>',back:'<path d="M31 31H61V55H31Z"/>',cardio:'<path d="M30 30H62V60H30ZM33 60H43V86H33ZM49 60H59V86H49Z"/>'};
    return `<div class="exercise-visual">${localImage ? `<img id="exercise-image" src="${e.image}" alt="種目のイラスト">` : ''}<div id="exercise-visual-fallback" ${localImage ? 'hidden' : ''}><svg viewBox="0 0 92 96" aria-hidden="true"><circle cx="46" cy="15" r="10" fill="#d9dce3"/><path d="M31 29Q46 23 61 29L70 54L63 57L57 41V59L60 87H49L46 66L43 87H32L35 59V41L29 57L22 54Z" fill="#d9dce3"/><g fill="#e43645" opacity=".8">${parts[e.category] || parts.cardio}</g></svg><span>${e.area}</span></div></div>`;
  }
  function render() {
    const e = current(), phase = session.phase, bossBattle = session.stage.type === 'checkpoint';
    const seconds = Math.ceil((session.remainingMs || 0) / 1000), timed = e?.unit === '秒';
    let content;
    if (['ready', 'countin', 'start', 'set', 'setclear'].includes(phase)) {
      let number = `${e.value}<small>回${e.sides === 2 ? '（左右各）' : ''}</small>`;
      let message = '表示の回数を行い、セット完了を押してね。';
      if (timed) {
        if (phase === 'ready') { number = `${e.value}<small>秒</small>`; message = session.side === 2 ? '反対側の準備をしよう。まもなくカウントが始まります。' : '姿勢を整えよう。まもなくカウントが始まります。'; }
        if (phase === 'countin') { number = `<span id="countdown" class="count-pop" role="timer">${seconds}</span>`; message = '準備してね'; }
        if (phase === 'start') { number = '<span class="timer-signal">START!</span>'; message = '呼吸を続けて、自分のペースで。'; }
        if (phase === 'set') { number = `<span id="countdown" role="timer" aria-label="残り秒数">${seconds}</span><small>秒</small>`; message = '呼吸を続けて、自分のペースで。'; }
        if (phase === 'setclear') { number = '<span class="timer-signal">SET CLEAR!</span>'; message = session.side < (e.sides || 1) ? '次は反対側です。' : 'よくできました！'; }
      }
      content = `<div class="workout-body"><div class="eyebrow">${phase === 'countin' ? 'GET READY' : 'QUEST TRAINING'}</div><h1>${e.name}</h1><p class="exercise-area">${e.area}</p>${exerciseVisual(e)}<div class="workout-amount">${number}</div>${timed && e.sides === 2 ? `<p class="muted">左右各${e.value}秒 · ${session.side} / 2側</p>` : ''}${setDisplay(e)}<p class="set-message" role="status">${session.paused ? '一時停止中' : message}</p></div><div class="workout-actions">${!timed ? `<button class="primary" id="set-finish" ${session.paused ? 'disabled' : ''}>セット完了</button>` : ''}<button class="secondary" id="workout-how" aria-haspopup="dialog">やり方を見る</button></div>`;
    } else if (phase === 'rest' || phase === 'restclear') {
      content = `<div class="workout-body"><h1 class="rest-title">REST</h1><p class="muted">次のセットまで</p><div class="workout-amount">${phase === 'rest' ? `<span id="countdown" role="timer" aria-label="休憩の残り秒数">${seconds}</span><small>秒</small>` : '<span class="timer-signal">NEXT SET!</span>'}</div><p class="rest-next">次：${e.name}</p>${setDisplay(e, true)}<p class="set-message" role="status">${session.paused ? '一時停止中' : phase === 'rest' ? 'ひと息ついて、体を休めよう。' : '次のセットへ進みます。'}</p></div>${phase === 'rest' ? `<button class="secondary" id="rest-skip" ${session.paused ? 'disabled' : ''}>休憩をスキップ</button>` : ''}`;
    } else if (phase === 'clear') {
      content = `<div class="workout-body"><div class="complete-mark" aria-hidden="true">✓</div><h1>${e.name}<br><span class="red">CLEAR！</span></h1><p class="set-message" role="status">${session.paused ? '一時停止中' : 'よくできました！'}</p></div>`;
    } else if (phase === 'exerciseRest') {
      const next = session.menu[session.index + 1];
      content = `<div class="workout-body"><p class="eyebrow">NEXT EXERCISE</p><h1 class="rest-title">種目間休憩</h1><div class="workout-amount"><span id="countdown" role="timer" aria-label="種目間休憩の残り秒数">${seconds}</span><small>秒</small></div><p class="rest-next">次：${next.name}</p><p class="muted">${next.amount} × ${next.sets}セット</p><p class="set-message" role="status">${session.paused ? '一時停止中' : 'ひと息ついて、次の種目の準備をしよう。'}</p></div><button class="secondary exercise-rest-skip" id="exercise-rest-skip" ${session.paused ? 'disabled' : ''}>休憩をスキップ</button>`;
    } else if (phase === 'complete') {
      const result = session.result;
      content = `<div class="workout-body workout-complete"><div class="celebration" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="complete-mark" aria-hidden="true">✓</div><h1 class="red">WORKOUT<br>COMPLETE!</h1><p class="complete-day">DAY ${session.stage.day} ${session.stage.title}</p><p>トレーニング完了！</p>${result.firstClear ? '' : '<p class="eyebrow">REPLAY CLEAR</p>'}<div class="xp-reward">${result.reward ? `+${result.reward} XP` : 'クリア済み'}</div>${result.reward ? '' : '<p class="muted">初回クリア報酬は獲得済みです。</p>'}</div><div class="rating-section"><h2 id="rating-title">今日のトレーニングはどうだった？</h2><div class="rating-options"><button class="option" data-rating="tooHard">😵 きつすぎた</button><button class="option" data-rating="justRight">👍 ちょうどいい</button><button class="option" data-rating="easy">😎 楽だった</button></div></div>`;
    } else {
      const result = session.result;
      const unlocked = TorequeStages.get(result.unlockedStage || result.unlockedDay);
      const chapterCleared = result.firstClear && TorequeStages.chapterComplete(session.stage.chapter, TorequeProgress.read().history);
      content = `<div class="workout-body"><div class="complete-mark" aria-hidden="true">✓</div>${result.level > result.previousLevel ? `<div class="level-up"><div class="eyebrow">LEVEL UP!</div><h1>Lv.${result.previousLevel} → Lv.${result.level}</h1><p class="level-carry">${result.levelXp} / ${result.requiredXp} XP</p></div>` : ''}${chapterCleared ? `<div class="chapter-finish"><p class="eyebrow">CHAPTER ${session.stage.chapter}</p><h1 class="red">COMPLETE!</h1></div>` : ''}${unlocked ? `<h1 class="red">${unlocked.label} UNLOCK!</h1><p>${unlocked.type === 'checkpoint' ? 'ここまでの成長を確認しよう' : '次のステージが解放されました'}</p>` : '<h1>おつかれさま！</h1><p>今日の評価を保存しました。</p>'}<p class="reward-total">合計 ${TorequeProgress.read().xp} XP</p></div><button class="primary" id="workout-continue">ホームへ</button>`;
    }
    const finished = ['complete', 'rewards'].includes(phase);
    const pause = finished ? '' : `<button class="pause-workout" id="workout-pause" aria-pressed="${session.paused}">${session.paused ? '再開' : '一時停止'}</button>`;
    if (bossBattle && phase === 'complete') {
      // 報酬の表示は評価後の既存ボス撃破・CHAPTER CLEAR画面にまとめます。
      const rating = content.slice(content.indexOf('<div class="rating-section">'));
      content = `<div class="workout-body workout-complete"><div class="complete-mark" aria-hidden="true">✓</div><h1 class="red">WORKOUT<br>COMPLETE!</h1><p class="complete-day">${session.stage.bossName}</p>${session.result.firstClear ? '' : `<p class="eyebrow">REPLAY CLEAR</p><div class="xp-reward">+${session.result.reward} XP</div>`}<p>BOSS HP 0% — ボス戦トレーニング完了！</p></div>${rating}`;
    }
    const devLabel = bossBattle ? session.stage.final ? 'DEV：FINAL BOSSを即クリア' : 'DEV：CHECK POINTを即クリア' : 'DEV：このDAYを即クリア';
    screen(`<section class="workout-screen workout-v2 phase-${phase} ${session.paused ? 'is-paused' : ''}">${progressHtml()}${content}${pause}${DEV_MODE && !finished ? `<button class="dev-clear-button" id="dev-day-clear">${devLabel}</button>` : ''}${exerciseDialogHtml()}<dialog class="exercise-dialog exit-dialog" id="exit-dialog" aria-labelledby="exit-title"><h2 id="exit-title">トレーニングを終了しますか？</h2><button class="primary" id="exit-cancel">トレーニングを続ける</button><button class="secondary" id="exit-confirm">終了してホームへ戻る</button></dialog></section>`);
    // DEV ONLY：古い画面のハンドラーで別の実行をクリアできないようrunIdも確認。
    if (DEV_MODE && !finished) {
      const runId = session.runId;
      document.getElementById('dev-day-clear').onclick = () => devComplete(runId);
    }
    const visualImage = document.getElementById('exercise-image');
    if (visualImage && e?.image) visualImage.onerror = () => {
      visualImage.hidden = true;
      document.getElementById('exercise-visual-fallback').hidden = false;
    };
    if (!finished) {
      document.getElementById('workout-exit').onclick = requestExit;
      document.getElementById('workout-pause').onclick = togglePause;
    }
    if (['ready', 'countin', 'start', 'set', 'setclear'].includes(phase)) {
      document.getElementById('workout-how').onclick = () => showExerciseExplanation(e, suspendForModal());
      if (!timed) document.getElementById('set-finish').onclick = completeReps;
    } else if (phase === 'rest') {
      document.getElementById('rest-skip').onclick = () => {
        if (session?.phase !== 'rest' || session.paused || session.modalDepth) return;
        // enterでRESTのタイマーと音を解除し、通常と同じNEXT演出へ進みます。
        enter('restclear', 2300, true);
      };
    } else if (phase === 'exerciseRest') {
      document.getElementById('exercise-rest-skip').onclick = () => {
        if (session?.phase !== 'exerciseRest' || session.paused || session.modalDepth) return;
        // advance→prepareSet→enterの既存cleanupで古いタイマーと音を解除します。
        advance();
      };
    } else if (phase === 'complete') {
      document.querySelectorAll('[data-rating]').forEach(button => { button.onclick = () => {
        if (session?.phase !== 'complete') return;
        if (!TorequeProgress.rate(session.stage.day, session.runId, button.dataset.rating)) return;
        if (bossBattle) {
          const id = session.stage.id, result = session.result;
          cancel(); finishBossBattle(id, result); return;
        }
        const nextStage = TorequeStages.next(session.stage.day);
        if (nextStage?.type === 'workout') getStagePlan(nextStage.id);
        enter('rewards');
      }; });
    } else if (phase === 'rewards') document.getElementById('workout-continue').onclick = () => { cancel(); homeScreen(); };
  }
  function requestExit() {
    if (!session) return;
    if (session.phase === 'complete') { document.getElementById('rating-title').scrollIntoView({ block: 'center' }); return; }
    if (session.phase === 'rewards') { cancel(); homeScreen(); return; }
    const dialog = document.getElementById('exit-dialog');
    if (dialog.open) return;
    dialog.onclose = suspendForModal();
    document.getElementById('exit-cancel').onclick = () => dialog.close();
    document.getElementById('exit-confirm').onclick = () => { dialog.onclose = null; cancel(); homeScreen(); };
    dialog.showModal();
  }
  window.addEventListener('beforeunload', event => {
    if (session && !['complete', 'rewards'].includes(session.phase)) { event.preventDefault(); event.returnValue = ''; }
  });
  return { start, cancel, stopTimer, requestExit, suspendForModal, restoreCompletion,
    devComplete() { if (session) devComplete(session.runId); }, isActive: () => !!session };
})();
