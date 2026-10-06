/* 保存の担当。ほかのアプリのlocalStorageには触れません。 */
const TorequeStorage = (() => {
  const KEY = 'toreque.v1.setup';
  let userId = null;
  const memory = new Map();
  const listeners = new Set();
  const keyFor = id => id ? `${KEY}.user.${id}` : KEY;
  const deletionKey = id => `toreque.account-delete.${id}`;
  function deletionState(id) { try { return id ? localStorage.getItem(deletionKey(id)) : null; } catch { return 'blocked'; } }
  function readKey(key) {
    if (memory.has(key)) return memory.get(key); // 書き込み失敗時も最新の進行を保持。
    try { return JSON.parse(localStorage.getItem(key)) || memory.get(key) || null; }
    catch { warn(); return memory.get(key) || null; }
  }
  function notify(type, data) {
    listeners.forEach(listener => { try { listener({ type, userId, data }); } catch { /* 同期失敗でゲーム保存を止めません。 */ } });
  }
  function warn() { document.getElementById('storage-warning').hidden = false; }
  return {
    read() {
      return readKey(keyFor(userId));
    },
    save(data, options = {}) {
      if (deletionState(userId)) return false;
      const key = keyFor(userId);
      memory.set(key, data);
      let persisted = true;
      try { localStorage.setItem(key, JSON.stringify(data)); memory.delete(key); }
      catch { warn(); persisted = false; }
      // 通常のAPIは同期のまま。必ずローカル保存の後に通知します。
      if (options.notify !== false) notify('save', data);
      return persisted;
    },
    reset() {
      if (deletionState(userId)) return false;
      const key = keyFor(userId), previous = readKey(key);
      memory.delete(key);
      try { localStorage.removeItem(key); notify('reset', previous); return true; }
      catch { warn(); return false; }
    },
    readForUser(id = null) { return readKey(keyFor(id)); },
    switchUser(id = null) { userId = id; },
    getUserId() { return userId; },
    getKey() { return keyFor(userId); },
    deletionState,
    beginDeletion(id) { localStorage.setItem(deletionKey(id), 'pending'); },
    cancelDeletion(id) { if (deletionState(id) === 'pending') localStorage.removeItem(deletionKey(id)); },
    finishDeletion(id) {
      if (!id) throw new Error('user required');
      localStorage.setItem(deletionKey(id), 'deleted');
      const base = keyFor(id);
      for (const key of Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))) {
        if (key === base || key === base + '.sync' || key?.startsWith(base + '.backup.')) localStorage.removeItem(key);
      }
      memory.delete(base);
      if (userId === id) userId = null;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
})();
