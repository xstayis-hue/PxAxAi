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

  // вехи стрика: награда за то, что возвращаешься день за днём
  var STREAK_MILESTONES = [
    { days: 30, reward: 120, title: 'Месяц вместе' },
    { days: 14, reward: 70, title: 'Две недели рядом' },
    { days: 7, reward: 40, title: 'Неделя подряд' },
    { days: 3, reward: 20, title: 'Три дня подряд' }
  ];

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load(storage) {
    var data = null;
    try { data = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) {}
    if (!data || data.date !== todayKey()) {
      data = {
        date: todayKey(), progress: {}, claimed: {},
        streak: (data && data.streak) || 0,
        lastActive: (data && data.lastActive) || null,
        streakClaimed: (data && Array.isArray(data.streakClaimed)) ? data.streakClaimed : [],
        pendingStreakReward: (data && data.pendingStreakReward) || null
      };
    }
    if (!Array.isArray(data.streakClaimed)) data.streakClaimed = [];
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
        // веха стрика — один раз на каждый уровень
        var claimed = Array.isArray(this.state.streakClaimed) ? this.state.streakClaimed : (this.state.streakClaimed = []);
        for (var i = 0; i < STREAK_MILESTONES.length; i++) {
          var m = STREAK_MILESTONES[i];
          if (this.state.streak >= m.days && claimed.indexOf(m.days) === -1) {
            claimed.push(m.days);
            save(storage, this.state);
            this.state.pendingStreakReward = { days: m.days, reward: m.reward, title: m.title };
            return this.state.streak;
          }
        }
        save(storage, this.state);
        return this.state.streak;
      }
      return this.state.streak;
    },
    // забираем награду за веху стрика (вызывается из UI, который начислит ◈)
    claimStreakReward: function (storage) {
      if (!this.state || !this.state.pendingStreakReward) return null;
      var r = this.state.pendingStreakReward;
      this.state.pendingStreakReward = null;
      save(storage, this.state);
      return r;
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
