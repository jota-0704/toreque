/* 小さな電子音とWORKOUT SOUND設定。音声ファイルは使いません。 */
const TorequeSound = (() => {
  const KEY = 'toreque.v1.sound';
  let enabled = true;
  let context;
  const voices = new Set();
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* 保存不可でも初期値ONで使えます。 */ }
  function unlock() {
    if (!enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ||= new Audio();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* 音を使えないブラウザでも画面と進行は動作します。 */ }
  }
  function silence() {
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices.clear();
  }
  function play(type = 'count') {
    if (!enabled || !context || context.state !== 'running') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const duration = type === 'count' ? 0.09 : 0.28;
      oscillator.type = 'sine';
      oscillator.frequency.value = type === 'count' ? 660 : 990;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      voices.add(oscillator);
      oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + duration + 0.02);
    } catch { /* 効果音失敗でタイマーを中断しません。 */ }
  }
  // Web Audioの時間軸で短い旋律を予約。JSタイマーを増やさず既存silenceで停止できます。
  function fanfare() {
    if (!enabled || !context || context.state !== 'running') return;
    silence();
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((hz, index) => {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const at = context.currentTime + index * .18, duration = index === notes.length - 1 ? .5 : .16;
        oscillator.type = 'triangle'; oscillator.frequency.value = hz;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.045, at + .02);
        gain.gain.exponentialRampToValueAtTime(.001, at + duration);
        oscillator.connect(gain); gain.connect(context.destination); voices.add(oscillator);
        oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + duration + .02);
      });
    } catch { /* 音が利用できなくてもクリア画面は表示します。 */ }
  }
  function setEnabled(value) {
    enabled = value;
    if (!enabled) silence();
    else unlock();
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); }
    catch { document.getElementById('storage-warning').hidden = false; }
    updateButton();
  }
  function updateButton() {
    const button = document.getElementById('sound-toggle');
    button.textContent = enabled ? 'ON' : 'OFF';
    button.setAttribute('aria-checked', String(enabled));
  }
  function bindSettings() {
    const dialog = document.getElementById('settings-dialog');
    document.getElementById('settings-open').onclick = () => {
      const resume = TorequeWorkout.suspendForModal();
      dialog.onclose = resume;
      updateButton(); dialog.showModal();
    };
    document.getElementById('sound-toggle').onclick = () => setEnabled(!enabled);
    document.getElementById('settings-close').onclick = () => dialog.close();
    updateButton();
  }
  return { unlock, silence, play, fanfare, bindSettings };
})();
