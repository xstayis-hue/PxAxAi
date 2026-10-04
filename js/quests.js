/* =========================================================
   PXAX · Nova — дейли-квесты и стрик
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'pxax_ai_quests_v1';

  var DAILY_QUESTS = [
    { id: 'chat3', title: 'Поговори с Ai (3 сообщения)', target: 3, reward: 6 },
    { id: 'feed', title: 'Покорми Ai', target: 1, reward: 5 },
    { id: 'care', title: 'Открой уход', target: 1, reward: 3 },
    { id: 'reflex', title: 'Сыграй в Neon Reflex', target: 1, reward: 4 },
    { id: 'run', title: 'Сыграй в Data Run', target: 1, reward: 4 }
  ];

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load(storage) {
    var data = null;
    try { data = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) {}
    if (!data || data.date !== todayKey()) {
      data = { date: todayKey(), progress: {}, claimed: {}, streak: data && data.streak || 0, lastActive: data && data.lastActive || null };
    }
    return data;
  }

  function save(storage, data) {
    try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  window.pxaxQuests = {
    state: null,
    init: function (storage) {
      this.state = load(storage);
      // стрик по последнему активному дню
      if (this.state.lastActive) {
        var diff = Math.floor((new Date(todayKey()) - new Date(this.state.lastActive)) / 86400000);
        if (diff > 1) this.state.streak = 0;
      }
      save(storage, this.state);
      return this.state;
    },
    track: function (storage, questId, delta) {
      if (!this.state) this.init(storage);
      var q = DAILY_QUESTS.find(function (x) { return x.id === questId; });
      if (!q) return { done: false, claimed: false };
      this.state.progress[questId] = (this.state.progress[questId] || 0) + (delta || 1);
      this.state.lastActive = todayKey();
      if (!this.state.claimed[questId] && this.state.progress[questId] >= q.target) {
        this.state.claimed[questId] = true;
        save(storage, this.state);
        return { done: true, claimed: true, reward: q.reward, title: q.title };
      }
      save(storage, this.state);
      return { done: this.state.progress[questId] >= q.target, claimed: false };
    },
    bumpStreakIfNewDay: function (storage) {
      if (!this.state) this.init(storage);
      if (this.state.lastActive !== todayKey()) {
        this.state.streak += 1;
        this.state.lastActive = todayKey();
        save(storage, this.state);
        return this.state.streak;
      }
      return this.state.streak;
    },
    list: function () { return DAILY_QUESTS.slice(); },
    progress: function (questId) {
      return this.state ? (this.state.progress[questId] || 0) : 0;
    },
    isClaimed: function (questId) {
      return !!(this.state && this.state.claimed[questId]);
    }
  };
})();
