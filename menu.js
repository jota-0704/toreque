/* 情報画面の担当。MENUはdialog内で表示し、進行中のワークアウトを保持します。 */
const TorequeMenu = (() => {
  const dialog = document.getElementById('menu-dialog');
  const content = document.getElementById('menu-content');
  const title = document.getElementById('menu-title');
  // SOUND・ジャンプ設定の既存ハンドラーと保存処理をそのまま利用します。
  const openSettings = document.getElementById('settings-open').onclick;
  const categories = [ ['upper', '胸・腕'], ['legs', '脚・お尻'], ['core', 'お腹・体幹'], ['cardio', '全身・体力'], ['back', '背中・体幹'] ];
  const pages = [ ['library', 'トレーニング図鑑', '30種目の動きとポイントを確認'], ['guide', 'トレクエの遊び方', '冒険の進め方をチェック'], ['records', '冒険の記録', 'これまでの積み重ねを見る'], ['settings', '設定', 'サウンド・ジャンプ系運動'], ['about', 'トレクエについて', 'この冒険のこと'] ];
  function page(name = 'main', exerciseId) {
    const back = '<button class="menu-back" id="menu-back">‹ MENUに戻る</button>';
    if (name === 'main') {
      title.textContent = 'MENU';
      content.innerHTML = '<div class="menu-cards">' + pages.map(([id, label, note], index) => '<button class="menu-card" data-menu-page="' + id + '"><span class="menu-card-number">' + String(index + 1).padStart(2, '0') + '</span><span><strong>' + label + '</strong><small>' + note + '</small></span><span aria-hidden="true">›</span></button>').join('') + '</div>';
      content.innerHTML += '<button class="menu-card auth-menu-entry" id="menu-account"><span aria-hidden="true">◇</span><span><strong>アカウント</strong><small>登録・ログイン・ログアウト</small></span><span aria-hidden="true">›</span></button>';
      document.getElementById('menu-account').onclick = () => { if (window.TorequeAuth) window.TorequeAuth.open(); };
    } else if (name === 'library') {
      title.textContent = 'トレーニング図鑑';
      content.innerHTML = back + '<p class="menu-intro">30種目の動きとコツを確認しよう。解放前の種目も読めます。</p>' + categories.map(([key, label]) => '<section class="library-category"><h3>' + label + '</h3><div class="library-list">' + TorequeTraining.catalog.filter(e => e.category === key).map(e => '<button class="library-card" data-library-id="' + e.id + '"><strong>' + e.name + '</strong><span>' + e.area + '</span><small>難易度 ' + e.difficulty + ' / 5</small></button>').join('') + '</div></section>').join('');
    } else if (name === 'exercise') {
      const e = TorequeTraining.catalog.find(item => item.id === exerciseId);
      if (!e) { page('library'); return; }
      title.textContent = e.name;
      content.innerHTML = '<button class="menu-back" id="library-back">‹ 図鑑に戻る</button><p class="menu-intro">' + e.area + ' · 難易度 ' + e.difficulty + ' / 5</p>' + exerciseIllustrationHtml(e) + '<section class="library-description"><h3>やり方</h3><p class="exercise-how-text">' + e.how + '</p><div class="point-box"><h3>POINT</h3><p>' + e.point + '</p></div><div class="caution-box"><h3>注意</h3><p>' + e.caution + '</p></div></section>';
    } else if (name === 'guide') {
      title.textContent = 'トレクエの遊び方';
      const steps = [ ['最初の質問に答える', '目的や重点部位、ジャンプできる環境などを選ぼう。'], ['ステージを選ぶ', '勇者がいる、挑戦可能なDAYから進もう。'], ['トレーニングする', '回数制は終わったらセット完了。時間制は準備してから開始しよう。'], ['今日の難易度を選ぶ', '「きつすぎた / ちょうどいい / 楽だった」から選ぼう。'], ['負荷が少しずつ調整される', '最近の評価をもとに、次のメニューの負荷が調整されます。'], ['XPを獲得してLEVEL UP', 'DAY初回クリアで100 XP。次のレベルを目指そう。'], ['CHECK POINTでボスに挑戦', '章の最後は復習トレーニングでボスに挑戦。評価後に新しい種目と次の冒険を解放しよう。'] ];
      content.innerHTML = back + '<ol class="guide-steps">' + steps.map(([heading, text]) => '<li><strong>' + heading + '</strong><p>' + text + '</p></li>').join('') + '</ol>';
    } else if (name === 'records') {
      title.textContent = '冒険の記録';
      content.innerHTML = window.TorequeOfficial?.managed() && !window.TorequeOfficial.ready() ?
        back + '<p class="menu-intro">正式な記録を確認できません。MENUのアカウントから「正式な記録を再確認」を押してください。</p>' :
        back + '<p class="menu-intro">あなたが積み重ねた冒険の記録。</p>' + adventureRecordsHtml(TorequeProgress.adventureSummary());
    } else if (name === 'settings') {
      title.textContent = '設定';
      content.innerHTML = back + '<p class="menu-intro">保存済みのサウンド・ジャンプ設定を変更できます。</p><button class="primary" id="menu-settings-open">設定を開く</button>';
      openSettings();
    } else if (name === 'about') {
      title.textContent = 'トレクエについて';
      content.innerHTML = back + '<div class="about-quest"><p>「トレクエ」は、筋トレ完全初心者が器具なしの家トレをRPG感覚で始めて継続するためのWebアプリです。</p><h3>初心者編：CHAPTER 1〜4</h3><p class="red">TO BE CONTINUED...</p><p>中級者編 Coming Soon</p><div class="caution-box"><p>運動中に強い痛みや異常を感じたら、無理に続けず中止してください。</p></div></div>';
    }
    document.querySelectorAll('[data-menu-page]').forEach(button => { button.onclick = () => page(button.dataset.menuPage); });
    document.querySelectorAll('[data-library-id]').forEach(button => { button.onclick = () => page('exercise', button.dataset.libraryId); });
    if (name !== 'main' && name !== 'exercise') document.getElementById('menu-back').onclick = () => page();
    if (name === 'exercise') document.getElementById('library-back').onclick = () => page('library');
    if (name === 'settings') document.getElementById('menu-settings-open').onclick = openSettings;
    dialog.scrollTop = 0;
    title.focus();
  }
  function open() {
    if (clearEffectActive || dialog.open) return;
    dialog.onclose = TorequeWorkout.suspendForModal();
    document.getElementById('menu-map').textContent = TorequeWorkout.isActive() ? 'トレーニングへ戻る' : 'ステージマップへ戻る';
    page(); dialog.showModal();
  }
  document.getElementById('settings-open').onclick = open;
  document.getElementById('menu-close').onclick = () => dialog.close();
  document.getElementById('menu-map').onclick = () => {
    dialog.close();
    if (TorequeWorkout.isActive()) return; // MENUを閉じる操作では終了確認を開かない。
    else if (readSetup()) homeScreen();
    else titleScreen();
  };
  return { open, page };
})();
