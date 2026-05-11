'use strict';
// ── Badge Poll — Shared Module ─────────────────────────────────────────────────
// Polls /api/classroom/provas/resumo-investigar for pending-pair counts and
// calls a user-supplied callback whenever fresh data arrives.
//
// Usage:
//   startBadgePoll(courseIds, onUpdate, intervalMs)
//     courseIds  — string[] of Classroom course IDs to check
//     onUpdate   — function(resumo) where resumo is { [courseId]: number }
//     intervalMs — poll interval in milliseconds (default: 3 minutes)
//
//   stopBadgePoll()
//     Cancels the active poll and removes visibility listeners.
//
// The module automatically pauses polling when the tab is hidden and resumes
// (firing an immediate fetch first) when the tab becomes visible again.

(function () {
    const RESUMO_URL = '/api/classroom/provas/resumo-investigar';
    const DEFAULT_MS = 3 * 60 * 1000;

    let _courseIds  = [];
    let _onUpdate   = null;
    let _intervalMs = DEFAULT_MS;
    let _timer      = null;
    let _active     = false;

    function _buildUrl(ids) {
        return RESUMO_URL + '?courseIds=' + encodeURIComponent(ids.join(','));
    }

    async function _fetch() {
        if (!_courseIds.length || !_onUpdate) return;
        try {
            const r = await fetch(_buildUrl(_courseIds), { credentials: 'include' });
            if (!r.ok) return;
            const data = await r.json();
            _onUpdate(data.resumo || {});
        } catch (_) { /* network hiccup — silently skip */ }
    }

    function _startTimer() {
        _stopTimer();
        _timer = setInterval(_fetch, _intervalMs);
    }

    function _stopTimer() {
        if (_timer !== null) {
            clearInterval(_timer);
            _timer = null;
        }
    }

    function _onVisibilityChange() {
        if (!_active) return;
        if (document.hidden) {
            _stopTimer();
        } else {
            _fetch();
            _startTimer();
        }
    }

    function startBadgePoll(courseIds, onUpdate, intervalMs) {
        stopBadgePoll();

        _courseIds  = Array.isArray(courseIds) ? courseIds : [];
        _onUpdate   = typeof onUpdate === 'function' ? onUpdate : null;
        _intervalMs = (Number.isFinite(intervalMs) && intervalMs >= 1000)
            ? intervalMs
            : DEFAULT_MS;
        _active = true;

        document.addEventListener('visibilitychange', _onVisibilityChange);

        if (!document.hidden) {
            _startTimer();
        }
    }

    function stopBadgePoll() {
        _active = false;
        _stopTimer();
        document.removeEventListener('visibilitychange', _onVisibilityChange);
        _courseIds  = [];
        _onUpdate   = null;
    }

    window.startBadgePoll = startBadgePoll;
    window.stopBadgePoll  = stopBadgePoll;
})();
