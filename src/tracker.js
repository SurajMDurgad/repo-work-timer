'use strict';
class Tracker {
  constructor(store) { this.store = store; this.previous = new Map(); }
  update(repos, sources, enabled, now = Date.now()) {
    const currentIds = new Set(repos.map(r => r.id));
    for (const [id, prior] of this.previous) {
      const elapsed = now - prior.time;
      // Delayed heartbeat = suspended host / sleeping computer. Never credit the gap.
      if (elapsed > 0 && elapsed <= 30000 && prior.sources.length) {
        this.store.append(prior.repo, { start: prior.time, end: now, sources: prior.sources });
      }
      if (!currentIds.has(id)) this.previous.delete(id);
    }
    for (const repo of repos) {
      this.previous.set(repo.id, { repo, time: now, sources: enabled && !this.store.paused(repo) ? [...(sources.get(repo.id) || [])] : [] });
    }
  }
  stop(now = Date.now()) { this.update([], new Map(), false, now); }
}
module.exports = { Tracker };
