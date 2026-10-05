/* DAYごとの履歴・報酬・連続日数。画面やメニュー生成とは分けて管理します。 */
const TorequeProgress = (() => {
  const RATINGS = ['tooHard', 'justRight', 'easy'];
  const replayLevel = value => Number.isInteger(value) ? Math.max(0, Math.min(TorequeTraining.REPLAY_MAX_LEVEL, value)) : 0;
  // 旧履歴のruns数では過去分を数え直さず、クリア済みは1回相当で移行します。
  function clearCountFor(record) {
    const minimum = record?.completed || record?.rewardClaimed ? 1 : 0;
    return Number.isSafeInteger(record?.clearCount) && record.clearCount >= 0 ? Math.max(minimum, record.clearCount) : minimum;
  }
  function requiredXp(level) { return 500 + (level - 1) * 250; }
  // xpはこれまでと同じ累計XP。レベル内XPは別に計算し、余りを持ち越します。
  function levelState(totalXp) {
    let level = 1, levelXp = Number.isFinite(totalXp) && totalXp >= 0 ? Math.floor(totalXp) : 0;
    while (levelXp >= requiredXp(level)) { levelXp -= requiredXp(level); level++; }
    return { level, levelXp, requiredXp: requiredXp(level) };
  }
  function levelFor(xp) { return levelState(xp).level; }
  function resultWithLevels(result) {
    if (!result) return result;
    return { ...result, ...levelState(result.xp), previousLevel: levelFor(Math.max(0, result.xp - (result.reward || 0))) };
  }
  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function previousDate(date) { const previous = new Date(date); previous.setDate(previous.getDate() - 1); return localDate(previous); }
  function normalize(saved = {}) {
    const old = saved.progress || {};
    const xp = Number.isFinite(old.xp) && old.xp >= 0 ? Math.floor(old.xp) : 0;
    const previousHistory = old.history && typeof old.history === 'object' ? old.history : {};
    const history = Object.fromEntries(Object.entries(previousHistory).map(([id, record]) =>
      [id, record && typeof record === 'object' ? { ...record, clearCount: clearCountFor(record) } : record]));
    const unlockedStages = TorequeStages.unlocked(history);
    const unlockedExercises = TorequeTraining.catalog.filter(e => e.requiredCheckpoint && history[e.requiredCheckpoint]?.completed).map(e => e.id);
    const pending = old.pending ? resultWithLevels(old.pending) : null;
    if (pending?.firstClear) pending.unlockedStage = TorequeStages.next(pending.day)?.id || null;
    return { ...old, xp, ...levelState(xp), levelSystem: 2, history,
      streak: Number.isInteger(old.streak) && old.streak >= 0 ? old.streak : 0,
      lastTrainingDate: old.lastTrainingDate || null,
      unlockedStages, unlockedDays: unlockedStages.filter(id => typeof id === 'number'), unlockedExercises, pending };
  }
  function read() {
    const saved = TorequeStorage.read() || {};
    const progress = normalize(saved);
    // 旧データのクリア履歴から新しい解放項目を補い、XPはそのまま維持します。
    if (saved.completed && (saved.progress?.levelSystem !== 2 || saved.progress?.level !== progress.level || saved.progress?.levelXp !== progress.levelXp || saved.progress?.requiredXp !== progress.requiredXp ||
        JSON.stringify(saved.progress?.unlockedStages) !== JSON.stringify(progress.unlockedStages) || JSON.stringify(saved.progress?.unlockedExercises) !== JSON.stringify(progress.unlockedExercises) ||
        Object.entries(progress.history).some(([id, record]) => record?.clearCount !== saved.progress?.history?.[id]?.clearCount))) TorequeStorage.save({ ...saved, progress });
    return progress;
  }
  function displayedStreak(date = new Date()) {
    const progress = read();
    return [localDate(date), previousDate(date)].includes(progress.lastTrainingDate) ? progress.streak : 0;
  }
  function complete(day, runId, date = new Date(), stats = null) {
    const saved = TorequeStorage.read() || {};
    const progress = normalize(saved);
    const previous = progress.history[day] || { runs: [] };
    const runs = Array.isArray(previous.runs) ? previous.runs : [];
    const existing = runs.find(run => run.id === runId);
    if (existing) return resultWithLevels(existing.result);
    const previousCount = clearCountFor(previous), clearCount = previousCount + 1;
    const firstClear = previousCount === 0 && !previous.rewardClaimed;
    const stage = TorequeStages.get(day);
    const workout = stage.type === 'workout';
    const reward = firstClear ? (stage.reward || 100) : previousCount === 1 ? 75 : 50;
    const oldLevel = progress.level;
    progress.xp += reward; Object.assign(progress, levelState(progress.xp));
    const today = localDate(date);
    if ((workout || stats) && progress.lastTrainingDate !== today) {
      progress.streak = progress.lastTrainingDate === previousDate(date) ? progress.streak + 1 : 1;
      progress.lastTrainingDate = today;
    }
    const next = firstClear ? TorequeStages.next(day) : null;
    const result = { day, runId, firstClear, clearCount, reward, xp: progress.xp, previousLevel: oldLevel,
      level: progress.level, levelXp: progress.levelXp, requiredXp: progress.requiredXp, unlockedStage: next?.id || null,
      unlockedDay: next?.type === 'workout' ? next.id : null };
    const completedAt = date.toISOString();
    progress.history[day] = { ...previous, completed: true, rewardClaimed: true, clearCount,
      firstClearAt: previous.firstClearAt || completedAt, completedAt,
      rating: previous.rating || null,
      runs: [...runs, { id: runId, completedAt, localDate: today, rating: null, stats, result }] };
    progress.unlockedStages = TorequeStages.unlocked(progress.history);
    progress.unlockedDays = progress.unlockedStages.filter(id => typeof id === 'number');
    progress.unlockedExercises = TorequeTraining.catalog.filter(e => e.requiredCheckpoint && progress.history[e.requiredCheckpoint]?.completed).map(e => e.id);
    if (workout || stats) progress.pending = result; // ボス戦も評価待ちを復元できます。旧確認式CPはそのまま。
    TorequeStorage.save({ ...saved, progress });
    return result;
  }
  function rate(day, runId, rating) {
    if (!RATINGS.includes(rating)) return false;
    const saved = TorequeStorage.read() || {};
    const progress = normalize(saved);
    const record = progress.history[day];
    const run = record?.runs?.find(item => item.id === runId);
    if (!run) return false;
    if (run.rating) return true;
    run.rating = rating; record.rating = rating;
    // 初回評価も「次に同じステージを遊ぶ時」の段階に反映。runIdごとに1回だけ。
    record.replayLoadLevel = Math.max(0, Math.min(TorequeTraining.REPLAY_MAX_LEVEL,
      replayLevel(record.replayLoadLevel) + (rating === 'easy' ? 1 : rating === 'tooHard' ? -1 : 0)));
    // DAY 2の生成根拠はDAY 1初回の評価に固定。再プレイで生成済みメニューを変えません。
    record.firstRating ||= rating;
    if (progress.pending?.runId === runId) progress.pending = null;
    TorequeStorage.save({ ...saved, progress });
    return true;
  }
  function completeCheckpoint(id, date = new Date()) {
    const progress = read();
    const stage = TorequeStages.get(id);
    if (stage?.type !== 'checkpoint' || !progress.unlockedStages.includes(id) || progress.pending) return null;
    if (progress.history[id]?.completed) return { day: id, firstClear: false, reward: 0,
      xp: progress.xp, level: progress.level, levelXp: progress.levelXp, requiredXp: progress.requiredXp,
      previousLevel: progress.level, unlockedStage: null };
    return complete(id, `${id}-clear`, date);
  }
  function chapterSummary(id) {
    const stage = TorequeStages.get(id);
    const progress = read();
    const saved = TorequeStorage.read() || {};
    const days = stage.reviewDays || (stage.final ? TorequeStages.all : TorequeStages.inChapter(stage.chapter)).filter(item => item.type === 'workout').map(item => item.id);
    let sets = 0, exercises = 0, missingRecords = 0;
    const reviews = days.map(day => {
      const record = progress.history[day] || {};
      const plan = saved.menus?.[day] || saved[{ 1: 'dayOne', 2: 'dayTwo' }[day]];
      const runs = Array.isArray(record.runs) && record.runs.length ? record.runs : record.completed ? [{}] : [];
      for (const run of runs) {
        if (Number.isInteger(run.stats?.sets) && Number.isInteger(run.stats?.exercises)) {
          sets += run.stats.sets; exercises += run.stats.exercises;
        } else if (Array.isArray(plan?.menu) && plan.menu.every(e => Number.isInteger(e.sets))) {
          // 旧版の完了履歴は、実際に保存されている固定メニューから集計。
          sets += plan.menu.reduce((sum,e) => sum + e.sets, 0); exercises += plan.menu.length;
        } else missingRecords++;
      }
      return { day, completed: !!record.completed, rating: record.rating || null };
    });
    // 新しいボス戦の実トレーニングだけ追加。旧確認式CPにはstatsがないため加算しません。
    TorequeStages.all.filter(item => item.type === 'checkpoint' && (stage.final || item.chapter === stage.chapter)).forEach(item => {
      for (const run of progress.history[item.id]?.runs || []) {
        if (Number.isInteger(run.stats?.sets) && Number.isInteger(run.stats?.exercises)) {
          sets += run.stats.sets; exercises += run.stats.exercises;
        }
      }
    });
    const counts = { tooHard: 0, justRight: 0, easy: 0 };
    reviews.forEach(review => { if (RATINGS.includes(review.rating)) counts[review.rating]++; });
    const max = Math.max(...Object.values(counts));
    let message = 'ここまで続けられたことが、次の一歩につながるよ。';
    if (max && counts.tooHard === max && counts.tooHard > counts.easy) message = '無理せず続けよう。次のステージでは負荷を少し調整するよ。';
    else if (max && counts.easy === max && counts.easy > counts.tooHard && counts.easy > counts.justRight) message = '余裕が出てきたみたい！次のステージでは少しだけレベルアップ！';
    else if (max) message = 'いいペース！この調子で続けよう！';
    const chapterXp = TorequeStages.inChapter(stage.chapter).reduce((total, item) => {
      const record = progress.history[item.id];
      if (!record?.completed) return total;
      const runs = Array.isArray(record.runs) ? record.runs : [];
      const recordedRewards = runs.filter(run => Number.isFinite(run.result?.reward));
      return total + (recordedRewards.length ? recordedRewards.reduce((sum, run) => sum + run.result.reward, 0) : record.rewardClaimed ? item.reward : 0);
    }, 0);
    return { chapterXp, xp: progress.xp, level: progress.level, streak: displayedStreak(),
      unlockedExerciseCount: progress.unlockedExercises.length, completedDays: reviews.filter(review => review.completed).length, sets, exercises, missingRecords, reviews, message };
  }
  // FINAL CLEARとMENUの冒険記録はこの集計を共通利用します。
  function adventureSummary() {
    const final = TorequeStages.all.find(stage => stage.final);
    const summary = chapterSummary(final.id);
    const history = read().history;
    const workouts = TorequeStages.all.reduce((sum, stage) => {
      const record = history[stage.id];
      if (stage.type === 'checkpoint') return sum + (record?.runs || []).filter(run => run.stats?.exerciseIds?.length).length;
      return sum + (Array.isArray(record?.runs) && record.runs.length ? record.runs.length : record?.completed ? 1 : 0);
    }, 0);
    return { ...summary, workouts };
  }
  return { adventureSummary, RATINGS, clearCountFor, requiredXp, levelState, levelFor, localDate, read, complete, rate, displayedStreak, completeCheckpoint, chapterSummary };
})();
