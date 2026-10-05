/* ステージを追加するときは、種類・表示・前提ステージをここで指定します。 */
const TorequeStages = (() => {
  // 敵画像はステージ定義から共通描画へ渡します。独自のenemyオブジェクトも指定可能。
  const enemies = {
    slime: { image: 'fat-slime.webp', name: '脂肪スライム', size: 'slime' },
    goblin: { image: 'dumbbell-goblin.webp', name: 'ダンベルゴブリン', size: 'goblin' },
    orc: { image: 'barbell-orc.webp', name: 'バーベルオーク', size: 'orc' }
  };
  const chapters = [
    { id: 1, title: 'ここから、強くなる。', intro: 'まずは、はじめの一歩から。' },
    { id: 2, title: '強さは、積み重なる。', intro: '冒険に慣れ、少しずつ強くなる。' },
    { id: 3, title: '強さは、挑戦の先に。', intro: '身につけた基礎で、次の挑戦へ。' },
    { id: 4, title: '最後の挑戦。', intro: '積み重ねた力で、最後の冒険へ。' }
  ];
  const all = [
    { id: 1, enemy: 'slime', type: 'workout', label: 'DAY 1', title: 'はじめの一歩', position: 'center', requires: null, available: true },
    { id: 2, enemy: 'goblin', type: 'workout', label: 'DAY 2', title: 'もう一歩、前へ', position: 'right', requires: 1, available: true },
    { id: 3, enemy: 'orc', type: 'workout', label: 'DAY 3', title: '積み重ねが、力になる', position: 'left', requires: 2, available: true },
    { id: 4, type: 'workout', label: 'DAY 4', title: '新しい挑戦', position: 'right', requires: 3, available: true },
    { id: 'checkpoint1', bossImage: 'muscle-king.webp', bossName: '筋肉の魔王', type: 'checkpoint', label: 'CHECK POINT', title: 'ここまでの成長を確認', position: 'left', requires: 4, available: true,
      chapter: 1, summaryScope: 'total', includeUnplayedReviews: true,
      reviewMessage: '最初の4日間、おつかれさま！', reward: 150, unlockExercises: ['wide', 'reverse-crunch', 'reverse-lunge'] },
    { id: 5, enemy: 'slime', chapter: 2, type: 'workout', title: '新たな道', position: 'left', requires: 'checkpoint1' },
    { id: 6, enemy: 'goblin', chapter: 2, type: 'workout', title: '昨日の自分を超えろ', position: 'right', requires: 5 },
    { id: 7, enemy: 'orc', chapter: 2, type: 'workout', title: '積み重ねの力', position: 'left', requires: 6 },
    { id: 8, enemy: 'goblin', chapter: 2, type: 'workout', title: '試される時', position: 'right', requires: 7 },
    { id: 9, enemy: 'slime', chapter: 2, type: 'workout', title: '新たな技', position: 'left', requires: 8 },
    { id: 10, enemy: 'orc', chapter: 2, type: 'workout', title: '一段上へ', position: 'right', requires: 9 },
    { id: 11, enemy: 'goblin', chapter: 2, type: 'workout', title: '次の世界へ', position: 'left', requires: 10 },
    { id: 'checkpoint2', bossImage: 'muscle-knight.webp', bossName: '鉄壁のマッスルナイト', chapter: 2, type: 'checkpoint', label: 'CHECK POINT', title: '第二の試練', position: 'left', requires: 11,
      reviewMessage: '7日間の冒険、おつかれさま！', reward: 150, unlockExercises: ['narrow', 'side-plank', 'climber'] }
,
    {"id":12,"chapter":3,"type":"workout","title":"新たな一歩","enemy":"slime","position":"right","requires":"checkpoint2"},
    {"id":13,"chapter":3,"type":"workout","title":"限界の少し先へ","enemy":"goblin","position":"left","requires":12},
    {"id":14,"chapter":3,"type":"workout","title":"積み重ねは裏切らない","enemy":"orc","position":"right","requires":13},
    {"id":15,"chapter":3,"type":"workout","title":"強くなる実感","enemy":"slime","position":"left","requires":14},
    {"id":16,"chapter":3,"type":"workout","title":"まだいける","enemy":"goblin","position":"right","requires":15},
    {"id":17,"chapter":3,"type":"workout","title":"壁を越えろ","enemy":"orc","position":"left","requires":16},
    {"id":18,"chapter":3,"type":"workout","title":"決戦の前","enemy":"slime","position":"right","requires":17},
    {"id":"checkpoint3","chapter":3,"type":"checkpoint","label":"CHECK POINT","title":"第三の試練","position":"left","requires":18,"bossImage":"muscle-dragon.webp","bossName":"マッスルドラゴン","summaryScope":"chapterAndTotal","reviewMessage":"挑戦を重ねた7日間、おつかれさま！","reward":150,"unlockExercises":["pike","leg-raise","high-knee"]},
    {"id":19,"chapter":4,"type":"workout","title":"最後の旅へ","enemy":"goblin","position":"left","requires":"checkpoint3"},
    {"id":20,"chapter":4,"type":"workout","title":"ここまでの力","enemy":"orc","position":"right","requires":19},
    {"id":21,"chapter":4,"type":"workout","title":"自分を超えろ","enemy":"slime","position":"left","requires":20},
    {"id":22,"chapter":4,"type":"workout","title":"あと少し","enemy":"goblin","position":"right","requires":21},
    {"id":23,"chapter":4,"type":"workout","title":"積み重ねた強さ","enemy":"orc","position":"left","requires":22},
    {"id":24,"chapter":4,"type":"workout","title":"決戦は近い","enemy":"slime","position":"right","requires":23},
    {"id":25,"chapter":4,"type":"workout","title":"最後の一歩","enemy":"goblin","position":"left","requires":24},
    {"id":"checkpoint4","chapter":4,"type":"checkpoint","final":true,"label":"FINAL CHECK POINT","title":"冒険の総まとめ","position":"left","requires":25,"bossImage":"true-muscle-king.webp","bossName":"真・筋肉の魔王","summaryScope":"adventure","reviewMessage":"ここまでの冒険を振り返ろう。","reward":300}
  ].map(stage => ({ chapter: 1, available: true, reward: 100, unlockExercises: [], ...stage,
    day: stage.type === 'workout' ? stage.id : null,
    enemy: stage.type === 'checkpoint' ? { image: stage.bossImage, name: stage.bossName, size: 'boss' } :
      typeof stage.enemy === 'string' ? enemies[stage.enemy] : stage.enemy || null,
    label: stage.label || `DAY ${stage.id}` }));
  const get = id => all.find(stage => String(stage.id) === String(id));
  function unlocked(history) {
    return all.filter(stage => {
      if (!stage.available) return false;
      if (history[stage.id]?.completed) return true; // 旧配置でのクリア済みステージも再訪できます。
      const visited = new Set();
      let prerequisite = stage.requires;
      while (prerequisite !== null) {
        const previous = get(prerequisite);
        if (!previous || visited.has(prerequisite) || !history[prerequisite]?.completed) return false;
        visited.add(prerequisite); prerequisite = previous.requires;
      }
      return true;
    }).map(stage => stage.id);
  }
  function next(id) { return all.find(stage => stage.available && stage.requires === id); }
  const inChapter = chapter => all.filter(stage => stage.chapter === chapter);
  const chapterComplete = (chapter, history) => inChapter(chapter).every(stage => history[stage.id]?.completed);
  return { all, chapters, inChapter, chapterComplete, get, unlocked, next };
})();
