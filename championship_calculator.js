// championship_calculator.js
(function () {
    function qs(id) { return document.getElementById(id); }
    function fmt(n) { return typeof n === 'number' ? n.toString() : String(n || ''); }
  
    // ---------- Core helpers ----------
    function getRemainingEventIndexes(champData) {
      const { eventCount, racePointsPerEvent } = champData;
      const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
      const remaining = [];
      for (let i = 0; i < eventCount; i++) {
        // If ALL drivers have no finishing points recorded for this event, treat it as remaining
        let anyPoints = false;
        for (const uid of uids) {
          const v = (racePointsPerEvent[uid] || [])[i] || 0;
          if (v > 0) { anyPoints = true; break; }
        }
        if (!anyPoints) remaining.push(i);
      }
      return remaining;
    }
  
    // Max finishing points per event (your format yields 40 in both normal & special)
    function maxEventFinishingPointsForIndex(idx, champData) {
      // Normal event: 20+20 = 40 ; Special: double R1 = 40
      return 40;
    }
  
    // Max bonus points available to the SAME driver per event:
    // - Pole (PP): 1
    // - Fastest Lap R1 (FL1): 1
    // - Fastest Lap R2 (FL2): 1 if normal event, 0 if special (you ignore R2 for specials)
    function maxEventBonusForIndex(idx, champData) {
      const isSpecial = (champData.specialEventIndexes || []).includes(idx);
      return isSpecial ? 2 : 3;
    }
  
    // Compute min/max totals and best/worst possible finishing position
    function computeExtremes(champData) {
      const {
        eventCount, keepEvents, driverNames,
        racePointsPerEvent, bonusPointsPerDriver, finalTotals,
        uidsByStandings
      } = champData;
  
      const uids = uidsByStandings || Object.keys(driverNames || {});
      const remainingIdxs = getRemainingEventIndexes(champData);
  
      // Per-driver arrays
      const minTotals = {};   // equals current total (can’t drop lower)
      const maxTotals = {};
      const minFinish = {};   // best rank (1 = champion)
      const maxFinish = {};   // worst rank
  
      // Precompute each driver’s finishing max (considering drops) and bonus max
      const finishingMax = {};
      const bonusMax = {};
  
      for (const uid of uids) {
        const base = (racePointsPerEvent[uid] || []).slice(); // copy
        // Normalise to length
        while (base.length < eventCount) base.push(0);
  
        // Hypothetical finishing points if driver wins remaining events
        const hyp = base.map((v, idx) => {
          if (remainingIdxs.includes(idx)) {
            return maxEventFinishingPointsForIndex(idx, champData);
          }
          return Number(v) || 0;
        });
  
        // Sum top keepEvents from hyp
        const hypSortedDesc = hyp.slice().sort((a, b) => b - a);
        const finishingMaxSum = hypSortedDesc.slice(0, keepEvents).reduce((s, x) => s + x, 0);
  
        finishingMax[uid] = finishingMaxSum;
  
        // Bonus: best-case add PP + FL1 (+ FL2 if normal) for each remaining event
        let bonusAdd = 0;
        for (const idx of remainingIdxs) {
          bonusAdd += maxEventBonusForIndex(idx, champData);
        }
        bonusMax[uid] = (bonusPointsPerDriver[uid] || 0) + bonusAdd;
  
        // Min/Max overall totals
        const currentTotal = finalTotals[uid] || 0;       // already counted + bonuses
        minTotals[uid] = currentTotal;                    // can’t go below current
        maxTotals[uid] = finishingMaxSum + bonusMax[uid]; // finishing max + bonus max
      }
  
      // Best possible rank for each driver:
      //   assume THIS driver hits max, everyone else stays at min
      for (const target of uids) {
        const scores = uids.map(uid => ({
          uid,
          score: uid === target ? maxTotals[target] : minTotals[uid]
        }));
        scores.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          // gentle tie-breaker: leave existing order by uidsByStandings
          return uids.indexOf(a.uid) - uids.indexOf(b.uid);
        });
        const bestIndex = scores.findIndex(s => s.uid === target);
        minFinish[target] = bestIndex + 1; // 1-based
      }
  
      // Worst possible rank:
      //   assume THIS driver stays at min, everyone else reaches max
      for (const target of uids) {
        const scores = uids.map(uid => ({
          uid,
          score: uid === target ? minTotals[target] : maxTotals[uid]
        }));
        scores.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return uids.indexOf(a.uid) - uids.indexOf(b.uid);
        });
        const worstIndex = scores.findIndex(s => s.uid === target);
        maxFinish[target] = worstIndex + 1;
      }
  
      return { minTotals, maxTotals, finishingMax, bonusMax, minFinish, maxFinish, remainingIdxs };
    }
  
    // ---------- Modal UI ----------
    function renderTable(champData, extremes) {
      const { driverNames, uidsByStandings } = champData;
      const uids = uidsByStandings || Object.keys(driverNames || {});
  
      const { minTotals, maxTotals, minFinish, maxFinish } = extremes;
  
      // Build table HTML
      let html = `
        <h3 style="margin:0 0 10px 0;">Title scenarios</h3>
        <p style="margin:0 0 8px 0;">
          Events remaining: <strong>${champData.eventsRemaining}</strong> &nbsp;•&nbsp;
          Drops: <strong>${champData.safeDropRaces}</strong> (keeping best ${champData.keepEvents})
        </p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse; width:100%; font-size:12px;">
            <thead>
              <tr style="background:#000;color:#fff;">
                <th style="padding:6px;border:1px solid #333;text-align:left;">Driver</th>
                <th style="padding:6px;border:1px solid #333;">Current</th>
                <th style="padding:6px;border:1px solid #333;">Min</th>
                <th style="padding:6px;border:1px solid #333;">Max</th>
                <th style="padding:6px;border:1px solid #333;">Best Pos</th>
                <th style="padding:6px;border:1px solid #333;">Worst Pos</th>
              </tr>
            </thead>
            <tbody>
      `;
  
      for (const uid of uids) {
        const name = driverNames[uid] || uid;
        const cur = champData.finalTotals[uid] || 0;
        const min = minTotals[uid] || 0;
        const max = maxTotals[uid] || 0;
        const best = minFinish[uid] || 1;
        const worst = maxFinish[uid] || 1;
  
        html += `
          <tr>
            <td style="padding:6px;border:1px solid #ccc;text-align:left;">${name}</td>
            <td style="padding:6px;border:1px solid #ccc;">${fmt(cur)}</td>
            <td style="padding:6px;border:1px solid #ccc;">${fmt(min)}</td>
            <td style="padding:6px;border:1px solid #ccc;">${fmt(max)}</td>
            <td style="padding:6px;border:1px solid #ccc;">${fmt(best)}</td>
            <td style="padding:6px;border:1px solid #ccc;">${fmt(worst)}</td>
          </tr>
        `;
      }
  
      html += `
            </tbody>
          </table>
        </div>
        <p style="font-size:11px;color:#666;margin-top:8px;">
          Notes: “Min” assumes no more points are scored. “Max” assumes wins for all remaining events
          (40 finishing points per event) and all own bonus points (PP + FL1 + FL2 on normal weekends).
          Off-podium fastest laps (OP) are excluded from the same driver’s max because they’re mutually exclusive with podiums.
        </p>
      `;
  
      qs('calcModalBody').innerHTML = html;
    }
  
    // ---------- Public API ----------
    window.openPointsCalculator = function (champData) {
      if (!champData) { alert('No championship data available yet.'); return; }
  
      // Compute and show
      const extremes = computeExtremes(champData);
      console.log('[Calculator] Data:', champData);
      console.log('[Calculator] Extremes:', extremes);
  
      renderTable(champData, extremes);
      qs('calcModal').style.display = 'flex';
    };
  
    window.closePointsCalculator = function () {
      const el = document.getElementById('calcModal');
      if (el) el.style.display = 'none';
    };
  
    // Click the dark backdrop to close
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('calcModal');
      if (!modal || modal.style.display !== 'flex') return;
      if (e.target === modal) window.closePointsCalculator();
    });
  })();
  