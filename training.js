/* 種目データとDAY 1生成。DOMや保存処理に依存しないので単独で確認できます。 */
const TorequeTraining = (() => {
  const VERSION = 1;
  const REPLAY_MAX_LEVEL = 3;
  const strength = ['筋肉をつけたい', '痩せたい・引き締めたい'];
  const cardio = ['体力をつけたい', '痩せたい・引き締めたい'];
  const gentle = ['健康のため', '筋肉をつけたい'];
  // 古い順に評価を渡すと、次回の「変化量」を返します。能力レベルは更新しません。
  function getLoadAdjustment(feedbackHistory = []) {
    const valid = ['tooHard', 'justRight', 'easy'];
    const recent = feedbackHistory.map(item => typeof item === 'string' ? item : item?.rating).filter(rating => valid.includes(rating)).slice(-3);
    const latest = recent.at(-1), previous = recent.at(-2);
    let action = 'maintain', reps = 0, seconds = 0, reason = '評価なし、または現在の負荷が適切';
    if (latest === 'tooHard') {
      if (previous === 'tooHard') { action = 'decrease'; reps = -2; seconds = -5; reason = '直近2回のきつすぎたが連続'; }
      else if (previous === 'easy') reason = '余裕があった後の1回だけのきつすぎたは維持';
      else { action = 'slightlyDecrease'; reps = -1; seconds = -2; reason = '単発のきつすぎたは最小限の調整'; }
    } else if (latest === 'easy') {
      action = 'slightlyIncrease';
      reps = previous === 'easy' || previous === 'justRight' ? 2 : 1;
      seconds = reps === 2 ? 5 : 3;
      reason = previous === 'easy' ? '余裕が直近2回続いた' : '今回余裕があるため小さく増やす';
    }
    const consecutiveHard = recent.length === 3 && recent.every(rating => rating === 'tooHard');
    const consecutiveEasy = recent.length === 3 && recent.every(rating => rating === 'easy');
    return { action, reps, seconds, recent, reason,
      // まず回数/秒数で調整。3回継続し、量の限界に達した場合だけ後段の調整を許可。
      allowSetChange: consecutiveHard || consecutiveEasy, allowDifficultyChange: consecutiveHard || consecutiveEasy };
  }
  function feedbackFromSaved(saved = {}) {
    const entries = [];
    Object.entries(saved.progress?.history || {}).forEach(([dayKey, record]) => {
      const boss = /^checkpoint[1-4]$/.test(dayKey);
      const day = boss ? dayKey : Number(dayKey);
      if (!boss && (!Number.isInteger(day) || day < 1)) return;
      const plan = boss ? saved.bossMenus?.[dayKey] : saved.menus?.[day] || saved[{ 1: 'dayOne', 2: 'dayTwo' }[day]];
      if (boss && !plan && !(record.runs || []).some(run => run.stats?.exerciseIds?.length)) return; // 旧確認式CPの評価は運動履歴に混ぜません。
      const ratedRuns = (Array.isArray(record.runs) ? record.runs : []).filter(run => ['tooHard', 'justRight', 'easy'].includes(run.rating));
      const runs = ratedRuns.length ? ratedRuns : record.rating || record.firstRating ? [{ rating: record.rating || record.firstRating, completedAt: record.completedAt || record.firstClearAt }] : [];
      runs.forEach((run, index) => entries.push({ day, rating: run.rating, completedAt: run.completedAt || null,
        menu: plan?.menu || [], order: entries.length, time: Number.isFinite(Date.parse(run.completedAt)) ? Date.parse(run.completedAt) : (boss ? Number(dayKey.slice(-1)) * 10000 : day * 1000) + index }));
    });
    return entries.sort((a,b) => a.time - b.time || a.order - b.order);
  }
  // 秒の種目はunit='秒'。左右種目は1セットで左右を行うためsides=2。
  function exercise(id, name, category, difficulty, goals, value, unit, how, point, sides = 1, caution) {
    const areas = { upper: '胸・腕', legs: '脚・お尻', core: 'お腹・体幹', cardio: '全身・体力', back: '背中・体幹' };
    return { id, name, category, area: areas[category], difficulty, goals, value, unit,
      sets: 2, restSeconds: 40, secondsPerRep: 3, sides, how, point, caution };
  }
  // 各画像の内容を確認済み。1種目IDにつき同名の単独JPEGを参照します。
  const catalog = [
    exercise('wall', '壁腕立て伏せ', 'upper', 1, gentle, 8, '回', "壁に向かって立ち、肩の高さに両手をつく。\n手は肩幅くらいに開く。\n肘を曲げて胸を壁へ近づけ、ゆっくり押し戻す。", "頭からかかとまで、体をまっすぐに保とう。", 1, "手が滑らない壁で行う。手首や肩に鋭い痛みが出たら中止する。"),
    exercise('wall-wide', 'ワイド壁腕立て伏せ', 'upper', 1, gentle, 8, '回', "壁に向かって立ち、肩の高さに両手をつく。\n手を肩幅より少し広く開く。\n肘を曲げて胸を壁へ近づけ、ゆっくり押し戻す。", "お腹に軽く力を入れ、腰を反らさないようにしよう。", 1, "手を広げすぎない。肩に痛みが出たら中止する。"),
    exercise('wall-narrow', 'ナロー壁腕立て伏せ', 'upper', 1, gentle, 6, '回', "壁に向かって立ち、肩の高さに両手をつく。\n手は肩幅くらいに開く。\n肘を体の近くで曲げ、胸を壁へ近づけて押し戻す。", "肩をすくめず、肘を外へ大きく広げないようにしよう。", 1, "手を極端に狭くしない。肘や手首に痛みが出たら中止する。"),
    exercise('knee', '膝つき腕立て伏せ', 'upper', 2, strength, 6, '回', "床に両手と両膝をつく。\n手を肩幅より少し広く開き、膝から頭までをまっすぐにする。\n肘を曲げて胸を床へ近づけ、ゆっくり押し戻す。", "お尻だけを後ろへ引かず、体全体を一緒に下ろそう。", 1, "胸を無理に床につけない。肩や手首に鋭い痛みが出たら中止する。"),
    exercise('pushup', '腕立て伏せ', 'upper', 3, strength, 6, '回', "床に両手とつま先をつく。\n手を肩幅より少し広く開き、体をまっすぐにする。\n肘を曲げて胸を床へ近づけ、ゆっくり押し戻す。", "腰が落ちないよう、お腹に軽く力を入れよう。", 1, "姿勢を保てない深さまで下ろさない。肩や手首に痛みが出たら中止する。"),
    exercise('wide', 'ワイドプッシュアップ', 'upper', 4, strength, 6, '回', "床に両手とつま先をつく。\n手を肩幅より広く開き、体をまっすぐにする。\n肘を曲げて胸を床へ近づけ、ゆっくり押し戻す。", "首をすくめず、体全体を一緒に動かそう。", 1, "手を広げすぎない。肩に鋭い痛みが出たら中止する。"),
    exercise('narrow', 'ナロープッシュアップ', 'upper', 4, strength, 5, '回', "床に両手とつま先をつく。\n手は肩幅くらいに開く。\n肘を体の近くで曲げ、胸を床へ近づけて押し戻す。", "腰を反らさず、体をまっすぐに保とう。", 1, "肘を無理に体へ押しつけない。手首や肘に痛みが出たら中止する。"),
    exercise('pike', 'パイクプッシュアップ', 'upper', 5, strength, 5, '回', "床に両手と足をつき、お尻を高く上げる。\n手は肩幅くらいに開く。\n肘を曲げて頭を床へ近づけ、ゆっくり押し戻す。", "頭を手の間へ近づけるように、動きを小さく始めよう。", 1, "頭を床につけない。肩や首に痛みが出たら中止する。"),
    exercise('squat', 'スクワット', 'legs', 1, strength, 8, '回', "足を肩幅くらいに開いて立つ。\nお尻を後ろへ引きながら、ゆっくり腰を下ろす。\n足裏で床を押し、ゆっくり立ち上がる。", "膝とつま先を同じ方向に向けよう。", 1, "かかとが浮くほど深く下ろさない。膝や腰に痛みが出たら中止する。"),
    exercise('wide-squat', 'ワイドスクワット', 'legs', 1, gentle, 8, '回', "足を肩幅より広く開き、つま先を少し外へ向けて立つ。\n膝を曲げ、ゆっくり腰を下ろす。\n足裏で床を押し、ゆっくり立ち上がる。", "膝もつま先と同じ方向に向けよう。", 1, "足を開きすぎない。膝や脚の付け根に痛みが出たら中止する。"),
    exercise('reverse-lunge', 'リバースランジ', 'legs', 2, strength, 5, '回', "足を腰幅くらいに開いて立つ。\n片足を後ろへ引き、両膝を曲げて腰を下ろす。\n前足で床を押して戻り、反対側も行う。", "前足の膝をつま先と同じ方向に向けよう。", 2, "ふらつく場合は壁に手を添える。膝に鋭い痛みが出たら中止する。"),
    exercise('split', 'スプリットスクワット', 'legs', 2, strength, 5, '回', "足を前後に開いて立つ。\n足の位置を変えず、両膝を曲げて腰を下ろす。\n前足で床を押して戻り、足を入れ替えて行う。", "体を前へ倒しすぎず、ゆっくり上下しよう。", 2, "ふらつく場合は壁に手を添える。膝に痛みが出たら中止する。"),
    exercise('bulgarian', 'ブルガリアンスクワット', 'legs', 4, strength, 5, '回', "動かない低い台に、片足の甲をのせる。\n前足を少し前へ出し、前足の膝を曲げて腰を下ろす。\n前足で床を押して戻り、足を入れ替えて行う。", "前足に体重をのせ、浅い動きから始めよう。", 2, "安定した台が必要。台が動く、またはバランスを保てない場合は行わない。"),
    exercise('bridge', 'ヒップリフト', 'legs', 1, gentle, 10, '回', "仰向けになり、膝を立てて足を腰幅くらいに開く。\n両手を体の横に置き、お尻をゆっくり上げる。\n肩から膝までがまっすぐになったら、ゆっくり下ろす。", "腰を反らすより、お尻に力を入れよう。", 1, "首に体重をかけない。腰に鋭い痛みが出たら中止する。"),
    exercise('calf', 'カーフレイズ', 'legs', 1, gentle, 10, '回', "足を腰幅くらいに開いて立つ。\n壁に手を添え、かかとをゆっくり上げる。\nかかとを静かに床へ戻す。", "体をまっすぐに保ち、反動を使わず動こう。", 1, "足首が外や内へ大きく傾かないようにする。痛みが出たら中止する。"),
    exercise('deadbug', 'デッドバグ', 'core', 1, gentle, 5, '回', "仰向けになり、両手を天井へ向ける。\n両脚を上げ、膝を直角くらいに曲げる。\n右手と左脚をゆっくり伸ばして戻し、反対側も行う。", "腰が床から大きく浮かない範囲で動かそう。", 2, "手足を無理に床まで下ろさない。腰に痛みが出たら中止する。"),
    exercise('crunch', 'クランチ', 'core', 1, strength, 8, '回', "仰向けになり、膝を立てる。\n両手を頭の後ろに軽く添える。\nお腹を縮めて肩を少し浮かせ、ゆっくり戻す。", "息を吐きながら、小さく上体を起こそう。", 1, "手で頭を引っ張らない。首や腰に痛みが出たら中止する。"),
    exercise('knee-plank', '膝つきプランク', 'core', 1, gentle, 15, '秒', "床に両肘と両膝をつく。\n肘を肩の真下に置き、膝から頭までをまっすぐにする。\nその姿勢を保つ。", "お腹に軽く力を入れ、呼吸を続けよう。", 1, "腰が落ちたらいったん休む。腰や肩に痛みが出たら中止する。"),
    exercise('reverse-crunch', 'リバースクランチ', 'core', 2, strength, 6, '回', "仰向けになり、両手を体の横に置く。\n両脚を上げ、膝を曲げる。\nお腹を縮めてお尻を少し浮かせ、ゆっくり戻す。", "脚を振る勢いではなく、お腹を使って小さく動こう。", 1, "お尻を高く上げすぎない。首や腰に痛みが出たら中止する。"),
    exercise('plank', 'プランク', 'core', 2, strength, 15, '秒', "床に両肘とつま先をつく。\n肘を肩の真下に置き、頭からかかとまでをまっすぐにする。\nその姿勢を保つ。", "お腹に軽く力を入れ、呼吸を止めないようにしよう。", 1, "腰が落ちたり反ったりしたら休む。痛みを我慢して続けない。"),
    exercise('side-plank', 'サイドプランク', 'core', 2, strength, 10, '秒', "横向きになり、両膝を曲げて床につける。\n下側の肘を肩の真下に置く。\n肘と下側の膝で支えて腰を上げ、姿勢を保つ。反対側も行う。", "肩から腰、膝までをまっすぐにしよう。", 2, "膝は床につけたまま行う。肩や腰に痛みが出たら中止する。"),
    exercise('leg-raise', 'レッグレイズ', 'core', 3, strength, 6, '回', "仰向けになり、両手を体の横に置く。\n両脚をそろえてゆっくり上げる。\n腰が大きく浮かない範囲まで、ゆっくり下ろす。", "お腹に軽く力を入れ、反動を使わず動こう。", 1, "床の近くまで無理に下ろさない。腰に痛みが出たら中止する。"),
    exercise('jack', 'ジャンピングジャック', 'cardio', 1, cardio, 20, '秒', "足をそろえて立ち、両腕を体の横に下ろす。\n小さく跳んで足を開き、両腕を頭の上へ上げる。\nもう一度小さく跳んで、足と腕を元へ戻す。", "膝を軽く曲げて、やわらかく着地しよう。", 1, "跳べる環境で行う。膝や足首に痛みが出たら中止する。"),
    exercise('step-jack', 'ステップジャック', 'cardio', 1, cardio, 20, '秒', "足をそろえて立ち、両腕を体の横に下ろす。\n片足を横へ出しながら、両腕を上げる。\n足と腕を戻し、反対側も繰り返す。", "跳ばずに、足をそっと床へ置こう。", 1, "腕は無理のない高さまで上げる。肩に痛みが出たら中止する。"),
    exercise('climber', 'マウンテンクライマー', 'cardio', 2, cardio, 15, '秒', "床に両手とつま先をつき、体をまっすぐにする。\n片方の膝をゆっくり胸へ近づけ、元へ戻す。\n反対側も同じように繰り返す。", "走らずに、左右交互にゆっくり動こう。", 1, "腰を反らさない。手首や腰に痛みが出たら中止する。"),
    exercise('high-knee', 'ハイニー', 'cardio', 1, cardio, 20, '秒', "足を腰幅くらいに開いて立つ。\n片方の膝をゆっくり上げ、足を静かに床へ戻す。\n反対側も繰り返し、その場でもも上げをする。", "跳ばずに、背中を伸ばして動こう。", 1, "膝は無理のない高さまで上げる。ふらつく場合は壁に手を添える。"),
    exercise('burpee', 'バーピー', 'cardio', 4, cardio, 4, '回', "しゃがんで両手を床につく。\n片足ずつ後ろへ出して体をまっすぐにし、片足ずつ手の近くへ戻す。\nゆっくり立ち上がる。ジャンプはしない。", "足を一度に跳ばして動かさず、一歩ずつ動こう。", 1, "急いで立ち上がらない。めまいや鋭い痛みが出たら中止する。"),
    // 「背中」の回答にも対応するため、器具なしの低負荷種目を追加。
    exercise('bird-dog', 'バードドッグ', 'back', 1, gentle, 5, '回', "床に両手と両膝をつく。\n手を肩の真下、膝を腰の真下に置く。\n右手と左脚をゆっくり伸ばして戻し、反対側も行う。", "体が左右に傾かないよう、お腹に軽く力を入れよう。", 2, "手足を高く上げすぎない。腰に痛みが出たら中止する。"),
    exercise('prone-w', 'うつ伏せWレイズ', 'back', 1, gentle, 6, '回', "うつ伏せになり、肘を曲げて腕をWの形にする。\n顔を床へ向けたまま、腕を少し浮かせる。\n背中の上の方を軽く寄せるように動かし、ゆっくり戻す。", "肩をすくめず、動きを小さくしよう。", 1, "頭を持ち上げて首を反らさない。肩や首に痛みが出たら中止する。"),
    exercise('snow-angel', 'リバーススノーエンジェル', 'back', 1, gentle, 6, '回', "うつ伏せになり、顔を床へ向ける。\n腕を体の横から頭の方へ、床の近くでゆっくり動かす。\n無理のない位置まで動かしたら、元へ戻す。", "肘を軽く曲げてもよいので、肩をすくめず動こう。", 1, "腰や首を反らさない。肩に痛みが出たら中止する。")
  ].map(item => ({ ...item, image: `images/${item.id}.jpeg`, requiresJump: item.id === 'jack', equipment: item.id === 'bulgarian' ? '台' : 'なし',
    requiredCheckpoint: ['wide', 'reverse-crunch', 'reverse-lunge'].includes(item.id) ? 'checkpoint1' :
      ['narrow', 'side-plank', 'climber'].includes(item.id) ? 'checkpoint2' :
      ['pike', 'leg-raise', 'high-knee'].includes(item.id) ? 'checkpoint3' : null }));

  function profileFrom(answers) {
    const difficulty = ['できない', '1〜5回', '6〜10回', '11〜20回', '21回以上'].indexOf(answers.pushups) + 1 || 1;
    const days = { '週1回': 1, '週2回': 2, '週3回': 3, '週4回': 4, '週5回以上': 5 }[answers.frequency] || 1;
    return { canJump: answers.canJump === true, goal: answers.goal, focus: answers.focus, initialDifficulty: difficulty,
      weekly: { days, atLeast: answers.frequency === '週5回以上', answer: answers.frequency },
      targetMinutes: { '10分': 10, '20分': 20, '30分': 30, '45分': 45, '60分以上': 60 }[answers.duration] || 10,
      // 腕立て回数は上半身だけに適用。他カテゴリは別々に変更できます。
      levels: { upper: difficulty, legs: 1, core: 1, cardio: 1, back: 1 } };
  }
  function generate(answers, savedLevels, options = {}) {
    const profile = profileFrom(answers);
    if (savedLevels) Object.keys(profile.levels).forEach(key => {
      if (Number.isInteger(savedLevels[key]) && savedLevels[key] >= 1 && savedLevels[key] <= 5) profile.levels[key] = savedLevels[key];
    });
    const focusCategory = { '胸・腕': 'upper', '脚・お尻': 'legs', 'お腹': 'core', '背中': 'back' }[profile.focus];
    const count = { 10: 3, 20: 4, 30: 5, 45: 6, 60: 6 }[profile.targetMinutes];
    const endurance = profile.goal === '体力をつけたい';
    const moving = endurance || profile.goal === '痩せたい・引き締めたい';
    const health = profile.goal === '健康のため';
    // レッグレイズだけ段階的に解放。他カテゴリーの初心者用上限は維持します。
    const latestRating = options.loadPolicy?.recent?.at(-1) || options.rating;
    const recentHardCount = (options.loadPolicy?.recent || []).slice(-3).filter(rating => rating === 'tooHard').length;
    // 内部レベルは自動上昇しないため、実際の腹部メニューと直近の評価で判断。
    // CHAPTER 3まで進み、腹部を含む直前メニュー＋直近3回中2回以上の適切/楽を条件にする。
    const comfortableCoreHistory = (options.baselineMenu || []).some(e => e.category === 'core') &&
      (options.loadPolicy?.recent || []).slice(-3).filter(rating => ['justRight', 'easy'].includes(rating)).length >= 2;
    const canUseLegRaise = !health && comfortableCoreHistory &&
      options.completedCheckpoints?.includes('checkpoint3') && latestRating !== 'tooHard' && recentHardCount < 2 &&
      // 直前に行った場合は他の腹部種目へ。楽だった評価でも毎回固定にしません。
      !(options.baselineMenu || []).some(e => e.id === 'leg-raise');
    const chosen = [];
    const references = new Map();
    function choose(category) {
      // 非上半身は初回は最大difficulty 2。健康目的は全カテゴリ最大2。
      const ceiling = health ? Math.min(2, profile.levels[category]) : category === 'upper' ? profile.levels.upper : Math.min(2, profile.levels[category] + 1);
      let candidates = catalog.filter(e => e.category === category && (!e.requiresJump || profile.canJump) && e.equipment === 'なし' &&
        (e.difficulty <= ceiling || e.id === 'leg-raise' && canUseLegRaise) &&
        (!e.requiredCheckpoint || options.completedCheckpoints?.includes(e.requiredCheckpoint)) && !chosen.some(c => c.id === e.id));
      const previousCategory = (options.baselineMenu || []).filter(e => e.category === category);
      const anchor = previousCategory[chosen.filter(e => e.category === category).length % (previousCategory.length || 1)];
      if (anchor && candidates.length) {
        // マンネリ防止は同程度の難易度で。単発評価で膝つき等へ大幅に落としません。
        let targetDifficulty = anchor.difficulty;
        const minimum = anchor.unit === '秒' ? 5 : 3, maximum = anchor.unit === '秒' ? 60 : 20;
        const saturated = options.loadPolicy?.allowDifficultyChange &&
          ((options.loadPolicy.reps < 0 && anchor.value <= minimum && anchor.sets <= 1) ||
           (options.loadPolicy.reps > 0 && anchor.value >= maximum && anchor.sets >= 3));
        if (saturated) targetDifficulty += options.loadPolicy.reps < 0 ? -1 : 1;
        const distance = Math.min(...candidates.map(e => Math.abs(e.difficulty - targetDifficulty)));
        candidates = candidates.filter(e => Math.abs(e.difficulty - targetDifficulty) === distance ||
          // 進行と実際の評価で準備できた場合だけ、解放したレッグレイズも比較候補に。
          // 負荷を減らす評価時の追加は避けます。
          e.id === 'leg-raise' && canUseLegRaise &&
          (options.loadPolicy?.reps || 0) >= 0 ||
          // 一度選ばれた後も、同じレッグレイズだけに固定せず難易度2と比較します。
          anchor.id === 'leg-raise' && canUseLegRaise && targetDifficulty === 3 && e.difficulty === 2);
        const sameUnit = candidates.filter(e => e.unit === anchor.unit && e.sides === (anchor.sides || 1));
        if (sameUnit.length) candidates = sameUnit;
      }
      candidates.sort((a, b) => score(b) - score(a) || catalog.indexOf(a) - catalog.indexOf(b));
      function score(e) {
        const previousPenalty = options.previousPlans ? options.previousPlans.reduce((sum, plan, i) => sum + (plan.menu.some(item => item.id === e.id) ? (i + 1) * 3 : 0), 0) : options.previousIds?.includes(e.id) ? 6 : 0;
        const unlockBonus = options.preferUnlocked && e.requiredCheckpoint && options.completedCheckpoints?.includes(e.requiredCheckpoint) ? 7 : 0;
        const focusUnlockBonus = e.id === 'leg-raise' && canUseLegRaise && focusCategory === 'core' ? 2 : 0;
        const reviewBonus = options.reviewIds?.includes(e.id) ? 4 : 0;
        return (e.goals.includes(profile.goal) ? 10 : 0) + (category === 'upper' && !health ? e.difficulty * 4 : 3 - e.difficulty) - previousPenalty + unlockBonus + focusUnlockBonus + reviewBonus + (e.id === options.preferredId ? 100 : 0);
      }
      if (candidates[0]) { chosen.push(candidates[0]); if (anchor) references.set(candidates[0].id, anchor); }
    }
    const focusCount = focusCategory ? Math.round(count / 2) : 0;
    for (let i = 0; i < focusCount; i++) choose(focusCategory);
    let rotation = moving ? ['cardio', 'legs', 'upper', 'core'] : ['upper', 'legs', 'core', 'cardio'];
    rotation = rotation.filter(category => category !== focusCategory);
    // 体力目的で長いメニューには全身系をもう1種目。重点の約半分は保持。
    if (endurance && count >= 5) rotation = ['cardio', ...rotation];
    let cursor = 0;
    while (chosen.length < count && cursor < 30) choose(rotation[cursor++ % rotation.length]);
    const menu = chosen.map(e => {
      const level = profile.levels[e.category];
      const increment = e.unit === '秒' ? Math.min(level - 1, 2) * 5 : Math.min(level - 1, 3) * 2;
      let sets = !health && profile.targetMinutes >= 30 && profile.weekly.days <= 3 ? 3 : e.sets;
      const baseValue = e.value + increment;
      const adjustment = options.rating === 'tooHard' ? -1 : options.rating === 'easy' ? 1 : 0;
      const step = e.unit === '秒' ? 2 : 1;
      const change = options.adjustment ? options.adjustment[e.unit === '秒' ? 'seconds' : 'reps'] : adjustment * step;
      let value = Math.max(e.unit === '秒' ? 5 : 3, baseValue + change);
      const reference = references.get(e.id);
      if (reference && options.loadPolicy) {
        const minimum = e.unit === '秒' ? 5 : 3, maximum = e.unit === '秒' ? 60 : 20;
        // 左右や回数/秒が変わる場合も、1セットあたりの動作時間を近づけます。
        const workSeconds = reference.value * (reference.unit === '秒' ? 1 : reference.secondsPerRep || 3) * (reference.sides || 1);
        const equivalent = Math.round(workSeconds / ((e.unit === '秒' ? 1 : e.secondsPerRep) * e.sides));
        const delta = e.unit === '秒' ? options.loadPolicy.seconds : options.loadPolicy.reps;
        const startValue = Math.max(minimum, Math.min(maximum, equivalent));
        value = Math.max(minimum, Math.min(maximum, startValue + delta));
        sets = Math.max(1, Math.min(3, reference.sets));
        if (value === startValue && delta && options.loadPolicy.allowSetChange) sets = Math.max(1, Math.min(3, sets + Math.sign(delta)));
      }
      // ボス復習の追加量は先頭1種目のみ。負荷維持の評価時に最大1回/2秒。
      if (options.bossReview && e === chosen[0] && !health && options.loadPolicy?.action === 'maintain' &&
          !options.loadPolicy.recent.includes('tooHard')) value = Math.min(e.unit === '秒' ? 60 : 20, value + (e.unit === '秒' ? 2 : 1));
      return { ...e, value, sets,
        amount: `${value}${e.unit}${e.sides === 2 ? '（左右各）' : ''}`,
        restSeconds: reference?.restSeconds || (health ? 45 : profile.weekly.days >= 4 ? 45 : moving ? 30 : 40),
        focused: e.category === focusCategory };
    });
    // 動作時間＋セット間休憩＋種目間の準備30秒＋ウォームアップ/整理運動120秒。
    function seconds() { return 120 + Math.max(0, menu.length - 1) * 30 + menu.reduce((sum, e) => sum + e.value * (e.unit === '秒' ? 1 : e.secondsPerRep) * e.sides * e.sets + e.restSeconds * (e.sets - 1), 0); }
    while (seconds() > profile.targetMinutes * 60 && menu.some(e => e.sets > 1)) {
      if (options.loadPolicy) {
        const reducible = [...menu].reverse().find(e => e.value > (e.unit === '秒' ? 5 : 3));
        if (reducible) {
          reducible.value--; reducible.amount = `${reducible.value}${reducible.unit}${reducible.sides === 2 ? '（左右各）' : ''}`;
          continue;
        }
      }
      [...menu].reverse().find(e => e.sets > 1).sets--;
    }
    return { version: VERSION, answerKey: JSON.stringify(answers), profile, menu,
      estimatedSeconds: seconds(), estimatedMinutes: Math.ceil(seconds() / 60) };
  }

  function sameAnswers(key, answers) {
    try {
      const clean = value => { const copy = { ...value }; delete copy.canJump; return JSON.stringify(copy); };
      return clean(JSON.parse(key)) === clean(answers);
    } catch { return false; }
  }
  function forEnvironment(plan, answers, completedCheckpoints = []) {
    const canJump = answers.canJump === true;
    const used = new Set(plan.menu.filter(e => !catalog.find(item => item.id === e.id)?.requiresJump).map(e => e.id));
    const menu = plan.menu.map(e => {
      const current = catalog.find(item => item.id === e.id);
      if (canJump || !current.requiresJump) return { ...e, requiresJump: current.requiresJump, how: current.how, point: current.point, caution: current.caution, image: current.image };
      const candidates = catalog.filter(item => !item.requiresJump && item.equipment === 'なし' &&
        item.category === current.category && item.difficulty <= current.difficulty &&
        (!item.requiredCheckpoint || completedCheckpoints.includes(item.requiredCheckpoint)) && !used.has(item.id));
      candidates.sort((a,b) => Number(b.unit === e.unit) - Number(a.unit === e.unit));
      const replacement = candidates[0];
      if (!replacement) return null;
      used.add(replacement.id);
      const seconds = e.value * (e.unit === '秒' ? 1 : e.secondsPerRep || 3) * (e.sides || 1);
      const value = Math.max(1, Math.round(seconds / ((replacement.unit === '秒' ? 1 : replacement.secondsPerRep) * replacement.sides)));
      return { ...replacement, value, sets: e.sets, restSeconds: e.restSeconds, focused: e.focused,
        amount: value + replacement.unit + (replacement.sides === 2 ? '（左右各）' : '') };
    });
    // 将来、代替候補のない種目が増えた場合も共通生成で必要数を確保。
    if (menu.some(e => !e)) return generate(answers, plan.profile.levels, { completedCheckpoints });
    return { ...plan, profile: { ...plan.profile, canJump }, menu };
  }

  function generateDayTwo(answers, savedLevels, dayOne, rating) {
    const history = Array.isArray(rating) ? rating : [rating];
    const policy = getLoadAdjustment(history);
    const baselineMenu = [...history].reverse().find(entry => entry?.menu?.length)?.menu || dayOne.menu;
    const plan = generate(answers, savedLevels, { previousIds: dayOne.menu.map(e => e.id), baselineMenu, loadPolicy: policy });
    // 種目候補が少ない初心者の重点部位でも、並びを変えて変化を持たせます。
    if (plan.menu.map(e => e.id).join() === dayOne.menu.map(e => e.id).join()) plan.menu.reverse();
    return { ...plan, day: 2, sourceRating: policy.recent.at(-1) || 'justRight', sourceRatings: policy.recent,
      loadAdjustment: policy, adjustment: { reps: policy.reps, seconds: policy.seconds } };
  }
  function generateStage(day, answers, levels, previousPlans = [], ratings = [], completedCheckpoints = []) {
    if (day === 1) return generate(answers, levels);
    if (day === 2) return generateDayTwo(answers, levels, previousPlans[0], ratings);
    const policy = getLoadAdjustment(ratings);
    const adjustment = { reps: policy.reps, seconds: policy.seconds };
    // 直前に評価したメニューを基準にします。再プレイの評価も利用できます。
    const baselineMenu = [...ratings].reverse().find(entry => entry?.menu?.length)?.menu || previousPlans.at(-1)?.menu || [];
    const options = { previousPlans, baselineMenu, loadPolicy: policy, adjustment,
      completedCheckpoints, preferUnlocked: day >= 4 };
    const signature = plan => plan.menu.map(e => e.id).sort().join(',');
    const previousSignatures = previousPlans.map(signature);
    let plan = generate(answers, levels, options);
    // 同じ「種目構成」になった場合、候補から1種目だけ変えます。
    if (previousSignatures.includes(signature(plan))) {
      for (const candidate of catalog) {
        if (plan.menu.some(e => e.id === candidate.id) || !plan.menu.some(e => e.category === candidate.category)) continue;
        const varied = generate(answers, levels, { ...options, preferredId: candidate.id });
        if (!previousSignatures.includes(signature(varied))) { plan = varied; break; }
      }
    }
    return { ...plan, day, sourceRatings: policy.recent, adjustment, loadAdjustment: policy };
  }
  function generateBoss(stage, answers, levels, chapterPlans = [], ratings = [], completedCheckpoints = []) {
    // 自分自身のクリア報酬・後の章の解放種目は、再戦でも候補にしません。
    const available = completedCheckpoints.filter(id => Number(id.replace('checkpoint', '')) < stage.chapter);
    const policy = getLoadAdjustment(ratings);
    const baselineMenu = [...ratings].reverse().find(entry => entry?.menu?.length)?.menu || chapterPlans.at(-1)?.menu || [];
    const plan = generate(answers, levels, { completedCheckpoints: available, baselineMenu,
      loadPolicy: policy, bossReview: true, reviewIds: [...new Set(chapterPlans.flatMap(plan => plan.menu.map(e => e.id)))] });
    return { ...plan, stageId: stage.id, sourceRatings: policy.recent, loadAdjustment: policy };
  }
  // 元の保存済みメニューから毎回計算。補正済みメニューを基準に積み増しません。
  function applyReplayLoad(plan, replayLevel) {
    const level = Number.isInteger(replayLevel) ? Math.max(0, Math.min(REPLAY_MAX_LEVEL, replayLevel)) : 0;
    if (!level) return plan;
    const menu = plan.menu.map(e => {
      const limit = e.unit === '秒' ? 45 : 20;
      const value = e.value >= limit ? e.value : Math.min(limit, e.value + level * (e.unit === '秒' ? 5 : 1));
      return { ...e, value, amount: `${value}${e.unit}${e.sides === 2 ? '（左右各）' : ''}` };
    });
    const seconds = items => 120 + Math.max(0, items.length - 1) * 30 + items.reduce((sum, e) =>
      sum + e.value * (e.unit === '秒' ? 1 : e.secondsPerRep || 3) * (e.sides || 1) * e.sets + e.restSeconds * (e.sets - 1), 0);
    // 選んだ時間の上限も維持。元のメニューが上限超過なら追加しません。
    const budget = Math.max(seconds(plan.menu), (plan.profile.targetMinutes || 10) * 60);
    for (let i = menu.length - 1; i >= 0; i--) {
      while (seconds(menu) > budget && menu[i].value > plan.menu[i].value) menu[i].value--;
      menu[i].amount = `${menu[i].value}${menu[i].unit}${menu[i].sides === 2 ? '（左右各）' : ''}`;
    }
    return { ...plan, menu, estimatedSeconds: seconds(menu), estimatedMinutes: Math.ceil(seconds(menu) / 60) };
  }
  return { sameAnswers, forEnvironment, VERSION, REPLAY_MAX_LEVEL, catalog, profileFrom, generate, generateDayTwo, generateStage, generateBoss, applyReplayLoad, getLoadAdjustment, feedbackFromSaved };
})();
