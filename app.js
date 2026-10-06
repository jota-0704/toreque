/* 初回設定・ホーム・詳細画面の担当。実行中の状態はworkout.jsで管理します。 */
// DEV ONLY：公開前はfalseにすると、すべてのテストボタンが非表示になります。
const DEV_MODE = false;

const QUESTIONS = [
  { key: 'goal', title: 'どんな自分を目指したい？', options: ['筋肉をつけたい', '痩せたい・引き締めたい', '体力をつけたい', '健康のため'] },
  { key: 'focus', title: '重点的に鍛えたいところは？', options: ['全身', '胸・腕', 'お腹', '脚・お尻', '背中', '特になし'] },
  { key: 'canJump', title: 'ジャンプする運動はできる？', options: ['できる', 'できない・音を立てたくない'], values: [true, false], notes: ['ジャンプを含む運動もOK', '静かにできる運動だけにする'] },
  { key: 'duration', title: '1回どれくらいトレーニングできそう？', options: ['10分', '20分', '30分', '45分', '60分以上'] },
  { key: 'pushups', title: '腕立て伏せは連続で何回くらいできる？', options: ['できない', '1〜5回', '6〜10回', '11〜20回', '21回以上'] }
];
const app = document.getElementById('app');
let answers = {};
let questionIndex = 0;
let loadingTimer;
let activeDetailDay = null;
let clearEffectTimer = null;
let clearEffectToken = 0;
let clearEffectActive = false;
let endingSoundActive = false;
let toastTimer;
let stagePressTimer = null;
let screenRevision = 0;
// 正式なアプリアイコン。画像を差し替える場合はこのパスを変更してください。
const LOGO_PATH = 'images/app-icon.png';

function readSetup() {
  const official = window.TorequeOfficial;
  if (official?.managed() && TorequeStorage.getUserId() !== window.TorequeAuth.getState().userId) return null;
  const raw = TorequeStorage.read();
  const saved = official?.managed() ? official.setup(raw) : raw;
  return saved && saved.completed === true && QUESTIONS.every(q => q.key === 'canJump' ? saved.answers?.canJump === undefined || typeof saved.answers.canJump === 'boolean' : q.options.includes(saved.answers?.[q.key])) ? saved : null;
}
function screen(html) {
  screenRevision++;
  clearTimeout(stagePressTimer);
  stagePressTimer = null;
  cancelClearEffect();
  activeDetailDay = null;
  TorequeWorkout.stopTimer();
  clearTimeout(loadingTimer);
  clearTimeout(toastTimer);
  document.getElementById('toast').hidden = true;
  app.innerHTML = html;
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  window.TorequeCloud?.onScreenChange();
}
function titleScreen() {
  const saved = readSetup();
  screen(`<section class="title-screen"><div class="eyebrow">YOUR TRAINING QUEST</div><div class="logo-space"><img src="${LOGO_PATH}" alt="" width="160" height="160"></div><h1 class="app-name">トレクエ</h1><p class="tagline">家で、少しずつ強くなる。</p><p class="intro">今日の小さな一歩が、<br>明日のあなたを変えていく。</p><button class="primary" id="start">${saved ? 'つづける' : 'はじめる'}</button><div class="title-foot"><span>器具なし</span><i></i><span>自分のペースで</span></div></section>`);
  document.getElementById('start').onclick = async () => {
    const button = document.getElementById('start');
    if (button.disabled) return;
    const view = screenRevision, label = button.textContent;
    const next = () => {
      if (view !== screenRevision) return;
      const currentSave = readSetup();
      if (currentSave) { answers = { ...currentSave.answers }; homeScreen(); }
      else { answers = {}; questionIndex = 0; questionScreen(); }
    };
    if (!window.TorequeOfficial?.managed()) { next(); return; }
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    const waiting = setTimeout(() => { if (view === screenRevision) button.textContent = '準備中…'; }, 600);
    try { await window.TorequeOfficial.navigateReady(next); }
    catch (error) {
      if (view === screenRevision) {
        const note = document.getElementById('toast');
        note.textContent = error.message || '正式記録を確認できません。もう一度お試しください。'; note.hidden = false;
      }
    } finally {
      clearTimeout(waiting); button.disabled = false; button.textContent = label; button.setAttribute('aria-busy', 'false');
    }
  };
}
function questionScreen() {
  const q = QUESTIONS[questionIndex];
  screen(`<section class="question-screen"><div class="progress-row"><button class="back" id="back" aria-label="${questionIndex ? '前の質問に戻る' : 'タイトルに戻る'}">‹</button><div class="progress" role="progressbar" aria-label="質問の進捗" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${questionIndex + 1}"><span style="width:${(questionIndex + 1) * 20}%"></span></div><span class="question-count">${questionIndex + 1} / 5</span></div><div class="eyebrow">LET'S FIND YOUR COURSE</div><h1>${q.title}</h1><p class="muted">今のあなたに近いものを選んでね。</p><div class="options" role="group" aria-label="${q.title}">${q.options.map((option, i) => `<button class="option ${answers[q.key] === (q.values ? q.values[i] : option) ? 'selected' : ''}" data-choice="${i}" aria-pressed="${answers[q.key] === (q.values ? q.values[i] : option)}"><span class="option-number">${String(i + 1).padStart(2, '0')}</span><span>${option}${q.notes ? `<small class="choice-note">${q.notes[i]}</small>` : ''}</span><span class="choice-dot" aria-hidden="true"></span></button>`).join('')}</div><button class="primary" id="next" ${answers[q.key] !== undefined ? '' : 'disabled'}>次へ</button><p class="small-note">あとから、自分のペースで進められます。</p></section>`);
  document.getElementById('back').onclick = () => { if (questionIndex) { questionIndex--; questionScreen(); } else titleScreen(); };
  document.querySelectorAll('[data-choice]').forEach(button => {
    button.onclick = () => {
      answers[q.key] = (q.values || q.options)[Number(button.dataset.choice)];
      document.querySelectorAll('[data-choice]').forEach(item => {
        const selected = item === button;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      document.getElementById('next').disabled = false;
    };
  });
  document.getElementById('next').onclick = () => {
    if (!(q.values || q.options).includes(answers[q.key])) return;
    if (++questionIndex < QUESTIONS.length) questionScreen();
    else { TorequeStorage.save({ completed: false, answers: { ...answers } }); creatingScreen(); }
  };
}
function creatingScreen() {
  screen(`<section class="course-screen loading-screen" aria-live="polite"><div class="spinner" aria-hidden="true"></div><div class="eyebrow">BUILDING YOUR QUEST</div><h1>あなたに合った<br>トレーニングを作成中...</h1><p class="muted">あなたのペースで進む冒険を、準備しています。</p></section>`);
  loadingTimer = setTimeout(() => {
    TorequeStorage.save({ completed: true, answers: { ...answers } });
    getDayOnePlan();
    completeScreen();
  }, 1600);
}
function completeScreen() {
  screen(`<section class="course-screen"><div class="complete-mark" aria-hidden="true">✓</div><div class="eyebrow">READY FOR YOUR QUEST</div><h1>あなたのコースが<br>完成しました！</h1><p class="muted">小さな一歩から、はじめよう。</p><dl class="course-details"><div><dt>目的</dt><dd id="summary-goal"></dd></div><div><dt>重点部位</dt><dd id="summary-focus"></dd></div><div><dt>ジャンプ系運動</dt><dd id="summary-canJump"></dd></div><div><dt>1回の時間</dt><dd id="summary-duration"></dd></div></dl><button class="primary" id="course">コースを見る</button></section>`);
  ['goal', 'focus', 'canJump', 'duration'].forEach(key => { document.getElementById(`summary-${key}`).textContent = key === 'canJump' ? answers.canJump ? 'できる' : '静かな運動のみ' : answers[key]; });
  document.getElementById('course').onclick = homeScreen;
}
function stageInfo(day) {
  return { ...TorequeStages.get(day), day };
}
function homeScreen(chapterId) {
  if (window.TorequeOfficial?.managed() && !window.TorequeOfficial.ready()) { window.TorequeOfficial.showRecovery(); return; }
  const progress = TorequeProgress.read();
  if (progress.pending) { TorequeWorkout.restoreCompletion(progress.pending); return; }
  if (window.TorequeOfficial?.managed() && window.TorequeOfficial.recoverActive()) return;
  TorequeWorkout.releaseFinished();
  // 表示専用。報酬・解放・レベル計算は既存の処理を利用します。
  const current = TorequeStages.all.find(stage => progress.unlockedStages.includes(stage.id) && !progress.history[stage.id]?.completed);
  const selected = Number.isInteger(chapterId) && TorequeStages.chapters.some(chapter => chapter.id === chapterId) ? chapterId : current?.chapter || TorequeStages.chapters.at(-1).id;
  const chapter = TorequeStages.chapters.find(item => item.id === selected);
  const visibleStages = TorequeStages.inChapter(selected);
  const mapHeight = visibleStages.reduce((sum, stage) => sum + (stage.type === 'checkpoint' ? 400 : 260), 0);
  const days = visibleStages.filter(stage => stage.type === 'workout');
  const completedCount = days.filter(stage => progress.history[stage.id]?.completed).length;
  const chapterCleared = TorequeStages.chapterComplete(selected, progress.history);
  const chapterTabs = TorequeStages.chapters.map(item => `<button class="chapter-tab" data-chapter="${item.id}" aria-pressed="${selected === item.id}">CHAPTER ${String(item.id).padStart(2,'0')}${TorequeStages.chapterComplete(item.id, progress.history) ? ' ✓' : ''}</button>`).join('');
  const xpPercent = progress.levelXp / progress.requiredXp * 100;
  const lock = '<svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z"/><path d="M12 14v3"/></svg>';
  const map = visibleStages.map((stage, index) => {
    const nextPosition = visibleStages[index + 1]?.position === 'right' ? 'right' : 'left';
    const thisPosition = stage.position === 'right' ? 'right' : 'left';
    const route = thisPosition === nextPosition ? 'route-straight' : nextPosition === 'right' ? 'route-right' : 'route-left';
    const day = stage.id, checkpoint = stage.type === 'checkpoint';
    const unlocked = progress.unlockedStages.includes(day), cleared = !!progress.history[day]?.completed;
    const here = current?.id === day;
    const status = cleared ? '✓ CLEAR' : unlocked ? 'START' : '';
    const enemy = stage.enemy;
    const enemyMarkup = enemy ? `<figure class="map-enemy ${enemy.size}" aria-label="${enemy.name}${cleared ? ' クリア済み' : unlocked ? '' : ' 未解放'}"><img src="images/${enemy.image}" alt="" draggable="false" width="1536" height="1024"><figcaption>${cleared ? '<span class="enemy-clear">✓ CLEAR</span>' : ''}${stage.final ? '<span class="final-boss-label">FINAL BOSS</span>' : ''}${enemy.name}</figcaption></figure>` : '';
    const heroMarkup = here ? '<div class="map-hero"><span class="location-bubble">いまここ！</span><img src="images/hero.webp" alt="トレクエ勇者：現在地" draggable="false" width="1536" height="1024"></div>' : '';
    return `<li style="--route-height:${visibleStages[index + 1]?.type === 'checkpoint' ? 360 : 260}px" class="stage ${stage.position} ${route} ${unlocked ? 'active' : 'locked'} ${cleared ? 'cleared' : ''} ${here ? 'current' : ''} ${checkpoint ? 'checkpoint' : ''} ${stage.final ? 'final-checkpoint' : ''}"><div class="stage-stop"><button class="stage-node" ${unlocked ? `id="${checkpoint ? 'stage-' + day : 'day-' + (['one', 'two', 'three'][day - 1] || day)}" data-stage="${day}" aria-label="${stage.label} ${stage.title}${cleared ? ' クリア済み' : ''}"` : `disabled aria-label="${stage.label} ${stage.title} ロック中"`}>${unlocked ? `<span aria-hidden="true">${cleared ? '✓' : checkpoint ? '⚑' : '▶'}</span>` : lock}</button></div><div class="stage-info"><span class="stage-day">${stage.label}</span><strong class="stage-title">${stage.title}</strong>${status ? `<span class="stage-status">${status}</span>` : '<span class="stage-lock-label">'+lock+'</span>'}</div>${enemyMarkup}${heroMarkup}</li>`;
  }).join('');
  screen(`<section class="home-screen home-v2"><div class="stats"><div><span class="stat-label"><span aria-hidden="true">♨</span> 連続日数</span><strong>連続 ${TorequeProgress.displayedStreak()}日</strong></div><div><span class="stat-label"><span aria-hidden="true">★</span> USER LEVEL</span><strong>Lv.${progress.level}</strong></div><div><span class="stat-label"><span aria-hidden="true">ϟ</span> XP</span><strong>${progress.levelXp} <small>XP</small></strong></div><div class="xp-track"><div class="xp-caption"><span>次のレベルまで</span><span>${progress.levelXp} / ${progress.requiredXp} XP</span></div><div class="mini-progress" role="progressbar" aria-label="次のレベルへの進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(xpPercent)}"><span style="width:${xpPercent}%"></span></div></div></div><nav class="chapter-tabs" aria-label="冒険の章">${chapterTabs}</nav><div class="chapter"><div class="chapter-copy"><div class="eyebrow">CHAPTER ${String(selected).padStart(2,'0')}</div><h1>${chapter.title}</h1><p>${chapter.intro}</p>${chapterCleared ? `<p class="chapter-clear">CHAPTER ${selected} COMPLETE</p>` : ''}<div class="chapter-progress-label">${completedCount} / ${days.length} DAY CLEAR</div><div class="mini-progress" role="progressbar" aria-label="DAYのクリア数" aria-valuemin="0" aria-valuemax="${days.length}" aria-valuenow="${completedCount}"><span style="width:${completedCount / days.length * 100}%"></span></div></div><span class="chapter-number" aria-hidden="true">${String(selected).padStart(2,'0')}</span></div><div class="map-header"><span>あなたの冒険</span><span class="muted">${completedCount} / ${days.length} DAY</span></div><div class="adventure-map" style="--map-height:${mapHeight}px"><div class="map-scenery" aria-hidden="true"><img src="images/map-scenery.svg" alt="" draggable="false"></div><ol class="stage-map" style="--map-height:${mapHeight}px">${map}</ol>${!current && selected === TorequeStages.all.at(-1).chapter ? '<div class="journey-end"><img src="images/hero.webp" alt="トレクエ勇者：冒険の続きへ" draggable="false" width="1536" height="1024"><p>QUEST CLEAR!</p></div>' : ''}</div><p class="map-end">一歩ずつ、あなたのペースで。</p></section>`);
  document.querySelectorAll('[data-chapter]').forEach(button => { button.onclick = () => homeScreen(Number(button.dataset.chapter)); });
  document.querySelectorAll('[data-stage]').forEach(bindStagePress);
}
// マップの配置は変更せず、短いタップでも押下状態を描画してから遷移する。
function bindStagePress(button) {
  const release = () => {
    if (stagePressTimer === null) button.classList.remove('pressed');
  };
  button.onpointerdown = event => {
    if (button.disabled || event.isPrimary === false || event.button !== 0 || stagePressTimer !== null) return;
    button.classList.add('pressed');
  };
  button.onpointercancel = release;
  button.onpointerleave = release;
  button.onblur = release;
  button.onclick = () => {
    if (button.disabled || stagePressTimer !== null) return;
    button.classList.add('pressed');
    stagePressTimer = setTimeout(() => {
      stagePressTimer = null;
      button.classList.remove('pressed');
      if (button.isConnected) openStage(button.dataset.stage);
    }, 120);
  };
}
function stageDetailScreen(day = 1) {
  if (!TorequeProgress.read().unlockedDays.includes(day)) { homeScreen(); return; }
  const stage = stageInfo(day);
  const plan = getPlayablePlan(day);
  const menu = plan.menu;
  screen(`<section class="detail-screen"><div class="detail-heading"><div class="eyebrow">DAY ${day}</div><h1>${stage.title}</h1></div><div class="workout-heading"><h2>今日のトレーニング</h2><span class="personalized-badge">あなた向けメニュー</span><p class="muted">目安：約${plan.estimatedMinutes}分</p><p class="menu-context" id="menu-context"></p></div><div class="exercise-list">${menu.map((exercise, index) => `<button class="exercise-card" data-exercise="${index}" aria-haspopup="dialog"><span class="exercise-number">${String(index + 1).padStart(2, '0')}</span><span class="exercise-info"><strong>${exercise.name}${exercise.focused ? '<span class="focus-badge">重点</span>' : ''}</strong><span class="exercise-area">${exercise.area}</span><span class="exercise-amount">${exercise.amount} × ${exercise.sets}セット</span></span><span class="exercise-help">やり方</span></button>`).join('')}</div><div class="detail-actions"><button class="primary" id="training-start">トレーニング開始</button><button class="secondary" id="home-back">ホームに戻る</button></div><dialog class="exercise-dialog" id="exercise-dialog" aria-labelledby="exercise-name"><div class="eyebrow">HOW TO TRAIN</div><h2 id="exercise-name"></h2><div id="exercise-illustration"></div><h3>やり方</h3><p id="exercise-how"></p><div class="point-box"><h3>POINT</h3><p id="exercise-point"></p></div><div class="caution-box"><h3>注意</h3><p id="exercise-caution"></p></div><button class="primary" id="explanation-close">説明を閉じる</button></dialog></section>`);
  activeDetailDay = day;
  document.getElementById('menu-context').textContent = `${plan.profile.goal} / ${plan.profile.focus} / ${readSetup()?.answers.canJump === true ? 'ジャンプOK' : '静かな運動のみ'}`;
  const dialog = document.getElementById('exercise-dialog');
  document.querySelectorAll('[data-exercise]').forEach(button => {
    button.onclick = () => {
      showExerciseExplanation(menu[Number(button.dataset.exercise)]);
    };
  });
  // dialogはEscでも閉じられ、閉じると押した種目カードへフォーカスが戻ります。
  document.getElementById('explanation-close').onclick = () => dialog.close();
  document.getElementById('home-back').onclick = homeScreen;
  document.getElementById('training-start').onclick = () => TorequeWorkout.start(getPlayablePlan(day).menu, day);
}
// 詳細画面と実行画面で共通の種目説明を使います。
function exerciseIllustrationHtml(exercise) {
  if (!exercise.image) return '';
  return '<div class="exercise-single-image"><img src="' + exercise.image + '" alt="' + exercise.name + 'の動き" loading="lazy" decoding="async"></div>';
}
function adventureRecordsHtml(summary) {
  const stats = [['TOTAL XP', summary.xp + ' XP'], ['USER LEVEL', 'Lv.' + summary.level], ['TOTAL CLEAR DAY', summary.completedDays], ['TOTAL WORKOUT', summary.workouts], ['CURRENT STREAK', summary.streak + '日'], ['TOTAL SET', summary.sets], ['TOTAL EXERCISE', summary.exercises]];
  return '<dl class="chapter-stats">' + stats.map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>').join('') + '</dl>' +
    (summary.referenceStats ? '<p class="review-note">SET・EXERCISEはメニューからの参考集計です。正式な実測記録はまだ保存していません。</p>' : '') +
    (summary.missingRecords ? '<p class="review-note">種目・セット数が未保存の過去記録は、その集計に含めていません。</p>' : '');
}
function exerciseDialogHtml() {
  return `<dialog class="exercise-dialog" id="exercise-dialog" aria-labelledby="exercise-name"><div class="eyebrow">HOW TO TRAIN</div><h2 id="exercise-name"></h2><div id="exercise-illustration"></div><h3>やり方</h3><p id="exercise-how"></p><div class="point-box"><h3>POINT</h3><p id="exercise-point"></p></div><div class="caution-box"><h3>注意</h3><p id="exercise-caution"></p></div><button class="primary" id="explanation-close">説明を閉じる</button></dialog>`;
}
function showExerciseExplanation(exercise, onClose = null) {
  const dialog = document.getElementById('exercise-dialog');
  document.getElementById('exercise-name').textContent = exercise.name;
  // 保存済みメニューの古い説明も、種目IDから最新の説明へ更新して表示。
  const description = TorequeTraining.catalog.find(item => item.id === exercise.id) || exercise;
  document.getElementById('exercise-illustration').innerHTML = exerciseIllustrationHtml(description);
  document.getElementById('exercise-how').textContent = description.how;
  document.getElementById('exercise-point').textContent = description.point;
  document.getElementById('exercise-caution').textContent = description.caution || ''; 
  dialog.onclose = onClose;
  document.getElementById('explanation-close').onclick = () => dialog.close();
  dialog.showModal();
}
function adaptSavedPlan(plan, currentAnswers) {
  const history = TorequeProgress.read().history;
  const completed = TorequeStages.all.filter(stage => stage.type === 'checkpoint' && history[stage.id]?.completed).map(stage => stage.id);
  return TorequeTraining.forEnvironment(plan, currentAnswers, completed);
}
function getDayOnePlan() {
  const saved = readSetup();
  const currentAnswers = saved ? saved.answers : answers;
  // 旧ユーザーは既存の回答をそのまま使い、必要な項目だけ追加して移行。
  const previous = saved?.dayOne;
  if (previous?.version === TorequeTraining.VERSION &&
      TorequeTraining.sameAnswers(previous.answerKey, currentAnswers) &&
      JSON.stringify(previous.profile?.levels) === JSON.stringify(saved.categoryLevels) &&
      Array.isArray(previous.menu) && previous.menu.length &&
      previous.menu.every(e => TorequeTraining.catalog.some(item => item.id === e.id))) return adaptSavedPlan(previous, saved.answers);
  const plan = TorequeTraining.generate(currentAnswers, saved?.categoryLevels);
  if (window.TorequeOfficial?.managed()) return window.TorequeOfficial.remember(1, plan);
  if (saved) TorequeStorage.save({ ...saved, categoryLevels: plan.profile.levels,
    weeklyPlan: plan.profile.weekly, dayOne: plan });
  return plan;
}
function getStagePlan(day) {
  if (day === 1) return getDayOnePlan();
  const saved = readSetup();
  const legacyKey = { 2: 'dayTwo' }[day];
  const previous = saved.menus?.[day] || (legacyKey ? saved[legacyKey] : null);
  if (previous?.version === TorequeTraining.VERSION && TorequeTraining.sameAnswers(previous.answerKey, saved.answers) &&
      Array.isArray(previous.menu) && previous.menu.length && previous.menu.every(e => TorequeTraining.catalog.some(item => item.id === e.id))) return adaptSavedPlan(previous, saved.answers);
  const preceding = TorequeStages.all.filter(stage => stage.type === 'workout');
  const previousPlans = preceding.slice(0, preceding.findIndex(stage => stage.id === day)).slice(-3).map(stage => getStagePlan(stage.id));
  const history = TorequeProgress.read().history;
  const ratings = window.TorequeOfficial?.managed() ? window.TorequeOfficial.feedback(day) : TorequeTraining.feedbackFromSaved(readSetup());
  const completedCheckpoints = window.TorequeOfficial?.managed() ? window.TorequeOfficial.checkpointsFor(day) : TorequeStages.all.filter(stage => stage.type === 'checkpoint' && history[stage.id]?.completed).map(stage => stage.id);
  const plan = TorequeTraining.generateStage(day, saved.answers, saved.categoryLevels, previousPlans, ratings, completedCheckpoints);
  if (window.TorequeOfficial?.managed()) return window.TorequeOfficial.remember(day, plan);
  // 旧キーも残しつつ、追加DAYは番号をキーにした共通メニュー保存を使います。
  const latest = readSetup();
  TorequeStorage.save({ ...latest, ...(legacyKey ? { [legacyKey]: plan } : {}), menus: { ...latest.menus, [day]: plan } });
  return plan;
}
function openStage(id) {
  const stage = TorequeStages.get(id);
  if (!stage || !TorequeProgress.read().unlockedStages.includes(stage.id)) return;
  if (stage.type === 'workout') stageDetailScreen(stage.id);
  else checkpointScreen(stage.id);
}
function getBossPlan(id) {
  const stage = TorequeStages.get(id), saved = readSetup();
  if (!saved || stage?.type !== 'checkpoint') return null;
  const ratings = window.TorequeOfficial?.managed() ? window.TorequeOfficial.feedback(id) : TorequeTraining.feedbackFromSaved(saved);
  const feedbackKey = JSON.stringify({ levels: saved.categoryLevels,
    recent: ratings.slice(-3).map(entry => [entry.day, entry.rating, entry.completedAt]) });
  const previous = saved.bossMenus?.[id];
  // クリア後のボスは元メニューを維持し、同ステージの再プレイ補正だけを重ねます。
  const stableReplay = saved.progress?.history?.[id]?.completed &&
    (!saved.categoryLevels || JSON.stringify(previous?.profile?.levels) === JSON.stringify(saved.categoryLevels));
  if (previous?.version === TorequeTraining.VERSION && (previous.feedbackKey === feedbackKey || stableReplay) && TorequeTraining.sameAnswers(previous.answerKey, saved.answers) &&
      previous.menu?.length && previous.menu.every(e => TorequeTraining.catalog.some(item => item.id === e.id))) return adaptSavedPlan(previous, saved.answers);
  const chapterDays = TorequeStages.inChapter(stage.chapter).filter(item => item.type === 'workout');
  const plans = chapterDays.map(day => getStagePlan(day.id));
  const history = TorequeProgress.read().history;
  const completed = TorequeStages.all.filter(item => item.type === 'checkpoint' && history[item.id]?.completed).map(item => item.id);
  const plan = TorequeTraining.generateBoss(stage, saved.answers, saved.categoryLevels, plans, ratings, completed);
  plan.feedbackKey = feedbackKey;
  if (window.TorequeOfficial?.managed()) return window.TorequeOfficial.remember(id, plan);
  const latest = readSetup();
  TorequeStorage.save({ ...latest, bossMenus: { ...latest.bossMenus, [id]: plan } });
  return plan;
}
function getPlayablePlan(id) {
  const stage = TorequeStages.get(id);
  const base = stage?.type === 'checkpoint' ? getBossPlan(id) : getStagePlan(id);
  if (!base) return null;
  const record = TorequeProgress.read().history[id];
  return record?.completed ? TorequeTraining.applyReplayLoad(base, record.replayLoadLevel) : base;
}
function startBossBattle(id) {
  const progress = TorequeProgress.read();
  if (progress.pending) { TorequeWorkout.restoreCompletion(progress.pending); return; }
  if (!progress.unlockedStages.includes(id)) return;
  const plan = getPlayablePlan(id);
  if (plan) TorequeWorkout.start(plan.menu, id);
}
function finishBossBattle(id, result) {
  const next = TorequeStages.next(id);
  if (next?.type === 'workout' && TorequeProgress.read().unlockedStages.includes(next.id)) getStagePlan(next.id);
  if (result.firstClear) bossDefeatScreen(id, result);
  else checkpointCompleteScreen(id, result);
}
function checkpointScreen(id = 'checkpoint1') {
  const progress = TorequeProgress.read();
  if (progress.pending) { TorequeWorkout.restoreCompletion(progress.pending); return; }
  if (!progress.unlockedStages.includes(id)) { homeScreen(); return; }
  const stage = TorequeStages.get(id), plan = getPlayablePlan(id);
  if (!plan) { titleScreen(); return; }
  const summary = TorequeProgress.chapterSummary(id);
  screen(`<section class="checkpoint-screen boss-intro"><div class="eyebrow">CHAPTER ${stage.chapter} · ${stage.label}</div><h1>BOSS BATTLE</h1><img class="battle-boss" src="images/${stage.bossImage}" alt="${stage.bossName}"><h2>${stage.bossName}</h2><p class="muted">このCHAPTERのトレーニングで、ボスに挑もう。</p><p class="personalized-badge">あなた向け復習メニュー · 約${plan.estimatedMinutes}分</p><div class="battle-menu">${plan.menu.map(e => `<div><strong>${e.name}</strong>${e.focused ? '<span class="focus-badge">重点</span>' : ''}<span>${e.area} · ${e.amount} × ${e.sets}セット</span></div>`).join('')}</div><details class="battle-records"><summary>ここまでの成長を見る</summary><p>TOTAL XP ${summary.xp} · Lv.${summary.level}</p><p>${summary.completedDays} DAY CLEAR · ${summary.sets} SETS</p></details><p class="review-note">${progress.history[id]?.completed ? '再戦' : '初回'}クリア +${progress.history[id]?.completed ? TorequeProgress.clearCountFor(progress.history[id]) === 1 ? 75 : 50 : stage.reward} XP。HPは進捗を表す演出です。</p><button class="primary" id="checkpoint-confirm">BOSS BATTLE START</button><button class="secondary" id="checkpoint-home">ホームに戻る</button>${DEV_MODE && !window.TorequeOfficial?.managed() ? `<button class="dev-clear-button" id="dev-checkpoint-clear">${stage.final ? 'DEV：FINAL BOSSを即クリア' : 'DEV：CHECK POINTを即クリア'}</button>` : ''}</section>`);
  let started = false;
  const begin = dev => {
    if (started || clearEffectActive) return;
    started = true; startBossBattle(id);
    if (dev) TorequeWorkout.devComplete();
  };
  document.getElementById('checkpoint-confirm').onclick = () => begin(false);
  if (DEV_MODE && !window.TorequeOfficial?.managed()) document.getElementById('dev-checkpoint-clear').onclick = () => begin(true);
  document.getElementById('checkpoint-home').onclick = homeScreen;
}
function cancelClearEffect() {
  clearEffectToken++;
  clearTimeout(clearEffectTimer); clearEffectTimer = null;
  if (clearEffectActive || endingSoundActive) TorequeSound.silence();
  endingSoundActive = false;
  clearEffectActive = false;
  document.getElementById('brand').disabled = false;
  document.getElementById('settings-open').disabled = false;
}
// 演出用タイマーは1本だけ。画面変更・リセットで古い遷移を無効化します。
function effectStep(html, duration, next) {
  screen(html);
  clearEffectActive = true;
  document.getElementById('brand').disabled = true;
  document.getElementById('settings-open').disabled = true;
  const token = clearEffectToken;
  clearEffectTimer = setTimeout(() => {
    clearEffectTimer = null;
    if (token !== clearEffectToken) return;
    next();
  }, duration);
}
function bossDefeatScreen(id, result) {
  const stage = TorequeStages.get(id);
  const final = !!stage.final;
  const shell = content => '<section class="boss-defeat ' + (final ? 'final-defeat' : '') + '" aria-live="polite">' + content + '</section>';
  effectStep(shell('<div class="defeat-flash" aria-hidden="true"></div><p class="eyebrow">' + (final ? 'FINAL BOSS' : 'CHAPTER ' + stage.chapter) + '</p><img class="defeat-boss" src="images/' + stage.bossImage + '" alt="' + stage.bossName + '"><p class="boss-name">' + stage.bossName + '</p>'), final ? 3200 : 2400, () => {
    if (!final) {
      effectStep(shell('<h1>BOSS DEFEATED!</h1><p>CHAPTER ' + stage.chapter + '</p><p>' + stage.bossName + 'を倒した！</p>'), 900, () => checkpointCompleteScreen(id, result));
      return;
    }
    // 最終ボスが消えた後、文字や音を出さない余韻を1秒設けます。
    effectStep(shell('<span class="visually-hidden">真・筋肉の魔王を倒した。</span>'), 1000, () => {
      effectStep(shell('<p class="final-quest-caption">FINAL QUEST COMPLETE</p>'), 900, () => {
        questClearScreen(id, result, true);
        TorequeSound.fanfare();
        endingSoundActive = true;
      });
    });
  });
}
function checkpointCompleteScreen(id, result) {
  const stage = TorequeStages.get(id);
  if (!result.firstClear) {
    const homeId = stage.final ? 'quest-home' : 'checkpoint-home';
    screen(`<section class="course-screen clear-revisit"><div class="complete-mark" aria-hidden="true">✓</div><div class="eyebrow">REPLAY CLEAR</div><h1>${stage.bossName}</h1><p>ボス再戦クリア！</p><div class="xp-reward">+${result.reward} XP</div>${result.level > result.previousLevel ? `<div class="level-up"><h2>LEVEL UP!</h2><p>Lv.${result.previousLevel} → Lv.${result.level}</p></div>` : ''}<p class="reward-total">TOTAL XP ${result.xp} · Lv.${result.level}</p><p>${result.levelXp} / ${result.requiredXp} XP</p><button class="primary" id="${homeId}">ステージマップへ戻る</button></section>`);
    document.getElementById(homeId).onclick = () => homeScreen(stage.chapter);
    return;
  }
  if (stage.final) { questClearScreen(id, result); return; }
  const next = TorequeStages.next(id);
  const nextAvailable = next && TorequeProgress.read().unlockedStages.includes(next.id);
  const chapterCleared = TorequeStages.chapterComplete(stage.chapter, TorequeProgress.read().history);
  const names = stage.unlockExercises.map(exerciseId => TorequeTraining.catalog.find(e => e.id === exerciseId).name);
  const messages = { 1: ['最初の試練を突破した！', '新たな冒険へ進もう。'], 2: ['確かな成長が、力になっている。', 'さらに先へ進もう。'], 3: ['最後の戦いへの道が開いた。', 'いよいよ最終章へ。'] };
  const message = messages[stage.chapter] || [];
  screen(`<section class="course-screen chapter-complete ${result.firstClear ? 'first-chapter-clear' : 'clear-revisit'}"> <div class="celebration" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="checkpoint-emblem" aria-hidden="true">✓</div><h1>CHAPTER ${stage.chapter}<br><span class="red">${chapterCleared ? 'COMPLETE!' : 'CHECK POINT CLEAR!'}</span></h1><div class="eyebrow">CLEAR REWARD</div><div class="xp-reward">${result.reward ? `+${result.reward} XP` : 'クリア済み'}</div>${result.level > result.previousLevel ? `<div class="level-up"><div class="eyebrow">LEVEL UP!</div><h2>Lv.${result.previousLevel} → Lv.${result.level}</h2><p class="level-carry">${result.levelXp} / ${result.requiredXp} XP</p></div>` : ''}<div class="unlocked-review"><h2>${result.firstClear ? 'NEW EXERCISES UNLOCKED!' : '解放済みの種目'}</h2><p>${result.firstClear ? '新しい種目が解放されました' : '初回クリア報酬は獲得済みです。'}</p><ul>${names.map((name, index) => `<li class="unlock-item" style="--unlock-delay:${index * .45}s">${result.firstClear ? '<small>UNLOCK!</small>' : ''}${name}</li>`).join('')}</ul></div>${nextAvailable ? `<h2 class="red">${next.label} ${result.firstClear ? 'UNLOCK!' : '解放済み'}</h2><p class="checkpoint-next">新しい冒険へ！</p>` : ''}<p class="chapter-final-message">${message.join('<br>')}</p><button class="primary" id="checkpoint-home">${nextAvailable ? '次のCHAPTERへ' : 'ホームへ'}</button></section>`);
  document.getElementById('checkpoint-home').onclick = () => homeScreen(nextAvailable ? next.chapter : stage.chapter);
}

// 最終CHECK POINTも共通報酬処理を利用し、演出だけを切り替えます。
function questClearScreen(id, result, fullEnding = false) {
  const summary = TorequeProgress.adventureSummary();
  const history = TorequeProgress.read().history;
  const bosses = TorequeStages.all.filter(stage => stage.type === 'checkpoint' && history[stage.id]?.completed);
  screen(`<section class="course-screen quest-clear ${fullEnding ? 'full-ending' : 'clear-revisit'}"><div class="celebration" aria-hidden="true">${Array.from({length: fullEnding ? 14 : 0}, (_, index) => '<i style="left:' + (5 + index * 6.8) + '%;animation-delay:' + (index % 4 * .12) + 's"></i>').join('')}</div><div class="eyebrow ending-title">QUEST CLEAR!</div><img class="quest-hero" src="images/hero.webp" alt="冒険を達成した勇者"><h1 class="ending-name">トレクエ CLEAR！</h1><div class="ending-message"><p class="growth-message">ここまでの積み重ねが、<br>あなたの強さになった。</p><h2>初心者編 COMPLETE</h2><p>筋トレ初心者からの卒業、おめでとう！</p><p class="review-note">トレクエの物語「初心者編」を達成しました。</p></div><div class="xp-reward">${result.reward ? '+' + result.reward + ' XP' : '初回報酬は獲得済み'}</div>${result.level > result.previousLevel ? '<div class="level-up"><h2>LEVEL UP!</h2><p>Lv.' + result.previousLevel + ' → Lv.' + result.level + '</p></div>' : ''}<div class="ending-records"><h2>YOUR JOURNEY</h2><ol class="journey-timeline"><li><strong>DAY 1</strong><span>冒険開始</span></li>${bosses.map(stage => '<li><strong>CHAPTER ' + stage.chapter + '</strong><span>' + stage.bossName + ' 撃破</span></li>').join('')}<li><strong>BEGINNER QUEST COMPLETE</strong></li></ol><h2 id="journey-records" tabindex="-1">冒険の記録</h2>${adventureRecordsHtml(summary)}<aside class="sequel-preview" aria-labelledby="sequel-title"><span class="sequel-path" aria-hidden="true">✦</span><h2 id="sequel-title">TO BE CONTINUED...</h2><p class="sequel-coming">中級者編 Coming Soon</p><p class="sequel-description">初心者編をクリアした冒険者へ。<br>新たなトレーニング、新たな敵、<br>そして新たな冒険を準備中！</p></aside><button class="primary" id="quest-home">ステージマップへ戻る</button></div></section>`);
  document.getElementById('quest-home').onclick = () => homeScreen(4);
}

// 開発者ツールのコンソールで torequeReset() を実行できます。
window.torequeReset = () => {
  TorequeWorkout.cancel();
  if (!TorequeStorage.reset()) return;
  clearTimeout(toastTimer);
  document.getElementById('toast').hidden = true;
  answers = {};
  questionIndex = 0;
  titleScreen();
};
document.getElementById('brand').onclick = () => {
  if (clearEffectActive) return;
  if (TorequeWorkout.isActive()) TorequeWorkout.requestExit();
  else titleScreen();
};
titleScreen();
TorequeSound.bindSettings();



// SOUNDの既存開閉・一時停止処理を維持したまま設定項目を追加。
function bindJumpSettings() {
  const button = document.getElementById('jump-toggle');
  function refresh() {
    const saved = readSetup();
    button.disabled = !saved;
    const enabled = saved?.answers.canJump === true;
    button.textContent = enabled ? 'ON' : 'OFF';
    button.setAttribute('aria-checked', String(enabled));
    document.getElementById('jump-note').textContent = !saved ? '初回質問で設定できます。' : saved.answers.canJump === undefined ? '未設定のため静かな運動のみです。ONにするとジャンプも候補になります。' : '次に開くメニューから反映します。実行中のトレーニングはそのまま続きます。';
  }
  const open = document.getElementById('settings-open').onclick;
  document.getElementById('settings-open').onclick = () => { refresh(); open(); };
  button.onclick = () => {
    const saved = readSetup(); if (!saved) return;
    const updated = { ...saved.answers, canJump: saved.answers.canJump !== true };
    TorequeStorage.save({ ...saved, answers: updated }); answers = updated; refresh();
    if (!TorequeWorkout.isActive() && activeDetailDay !== null) stageDetailScreen(activeDetailDay);
  };
  refresh();
}
bindJumpSettings();
