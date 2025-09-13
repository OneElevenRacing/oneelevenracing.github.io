// championship_calculator.js
(function () {
    function qs(id) { return document.getElementById(id); }
    function fmt(n) { return typeof n === 'number' ? n.toString() : String(n || ''); }
  
    // === CONFIG: non-attendance baseline ===
    // If your "one behind last" equals 0, leave these at 0.
    // If you actually award a point (or more) for skipping, set accordingly.
    const NON_ATTEND_POINTS_NORMAL  = 10; // baseline finishing points for a normal weekend when not attending
    const NON_ATTEND_POINTS_SPECIAL = 10; // baseline finishing points for a special weekend when not attending
  
    // ---------- Core helpers ----------
    function getRemainingEventIndexes(champData) {
      const { eventCount, racePointsPerEvent } = champData;
      const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
      const remaining = [];
      for (let i = 0; i < eventCount; i++) {
        // Treat an event as "remaining" if no driver has any finishing points recorded for it yet
        let anyPoints = false;
        for (const uid of uids) {
          const v = (racePointsPerEvent[uid] || [])[i] || 0;
          if (v > 0) { anyPoints = true; break; }
        }
        if (!anyPoints) remaining.push(i);
      }
      return remaining;
    }
  
    function isSpecialIndex(idx, champData) {
      return (champData.specialEventIndexes || []).includes(idx);
    }
  
    // Max finishing points per event for a single driver under your rules:
    // - Normal: R1 + R2 = 20 + 20 = 40
    // - Special: R1 double = 40 (R2 ignored)
    function maxEventFinishingPointsForIndex(idx, champData) {
      return 40;
    }
  
    // Min finishing points per event for a single driver (non-attendance baseline)
    function minEventFinishingPointsForIndex(idx, champData) {
      return isSpecialIndex(idx, champData) ? NON_ATTEND_POINTS_SPECIAL : NON_ATTEND_POINTS_NORMAL;
    }
  
    // Max bonus a single driver can still get on that event
    // - Normal: PP (1) + FL1 (1) + FL2 (1) = 3
    // - Special: PP (1) + FL1 (1) = 2 (R2 ignored)
    function maxEventBonusForIndex(idx, champData) {
      return isSpecialIndex(idx, champData) ? 2 : 3;
    }
  
    // ---------- Extremes calculator ----------
    function computeExtremes(champData) {
      const {
        eventCount, keepEvents, driverNames,
        racePointsPerEvent, bonusPointsPerDriver, finalTotals,
        uidsByStandings
      } = champData;
  
      const uids = uidsByStandings || Object.keys(driverNames || {});
      const remainingIdxs = getRemainingEventIndexes(champData);
  
      const minTotals = {};   // worst-case (with baseline points for non-attendance)
      const maxTotals = {};   // best-case (wins + all own bonuses)
      const minFinish = {};   // best position (1 = champion) possible
      const maxFinish = {};   // worst position possible
  
      const finishingMax = {};
      const finishingMin = {};
      const bonusMax = {};
  
      for (const uid of uids) {
        const base = (racePointsPerEvent[uid] || []).slice();
        while (base.length < eventCount) base.push(0);
  
        // --- MAX (finishing) ---
        const hypMax = base.map((v, idx) => remainingIdxs.includes(idx)
          ? maxEventFinishingPointsForIndex(idx, champData)
          : (Number(v) || 0)
        );
        const hypMaxSorted = hypMax.slice().sort((a, b) => b - a);
        const finishingMaxSum = hypMaxSorted.slice(0, keepEvents).reduce((s, x) => s + x, 0);
        finishingMax[uid] = finishingMaxSum;
  
        // --- MIN (finishing, using baseline for remaining events) ---
        const hypMin = base.map((v, idx) => remainingIdxs.includes(idx)
          ? minEventFinishingPointsForIndex(idx, champData)
          : (Number(v) || 0)
        );
        const hypMinSorted = hypMin.slice().sort((a, b) => b - a);
        const finishingMinSum = hypMinSorted.slice(0, keepEvents).reduce((s, x) => s + x, 0);
        finishingMin[uid] = finishingMinSum;
  
        // Bonuses
        const currentBonus = bonusPointsPerDriver[uid] || 0;
  
        // If you don't attend, you can't add more bonus — so min bonus add = 0
        const bonusAdd = remainingIdxs.reduce((acc, idx) => acc + maxEventBonusForIndex(idx, champData), 0);
        bonusMax[uid] = currentBonus + bonusAdd;
  
        // Final min/max totals
        minTotals[uid] = finishingMinSum + currentBonus; // old "currentTotal" replaced by recomputed min
        maxTotals[uid] = finishingMaxSum + bonusMax[uid];
      }
  
      // Best possible rank for each driver: they hit max, others stay at *their* min
      for (const target of uids) {
        const scores = uids.map(uid => ({
          uid,
          score: uid === target ? maxTotals[target] : minTotals[uid]
        }));
        scores.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          // tie-break with current standings order to keep it stable
          return uids.indexOf(a.uid) - uids.indexOf(b.uid);
        });
        minFinish[target] = scores.findIndex(s => s.uid === target) + 1;
      }
  
      // Worst possible rank: they stay at min, everyone else hits max
      for (const target of uids) {
        const scores = uids.map(uid => ({
          uid,
          score: uid === target ? minTotals[target] : maxTotals[uid]
        }));
        scores.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return uids.indexOf(a.uid) - uids.indexOf(b.uid);
        });
        maxFinish[target] = scores.findIndex(s => s.uid === target) + 1;
      }
  
      return { minTotals, maxTotals, finishingMin, finishingMax, bonusMax, minFinish, maxFinish, remainingIdxs };
    }
  
    // ---------- Modal UI ----------
    function renderTable(champData, extremes) {
        const { driverNames, uidsByStandings } = champData;
        const uids = uidsByStandings || Object.keys(driverNames || {});
        const { minTotals, maxTotals, minFinish, maxFinish } = extremes;
      
        let html = `
          <h3 style="margin:0 0 10px 0;">Title Scenarios</h3>
          <p style="margin:0 0 8px 0;">
            Events remaining: <strong>${champData.eventsRemaining}</strong> &nbsp;•&nbsp;
            Drop Races: <strong>${champData.safeDropRaces}</strong> (keeping best ${champData.keepEvents})
          </p>
          <div style="overflow-x:auto;">
            <table class="calc-table" style="border-collapse:collapse; width:100%;">
              <thead>
                <tr>
                  <th class="pos-col" style="padding:6px;border:1px solid #333;">Pos</th>
                  <th style="padding:6px;border:1px solid #333;text-align:left;">Driver</th>
                  <th style="padding:6px;border:1px solid #333;">Current Points</th>
                  <th style="padding:6px;border:1px solid #333;">Min Pts</th>
                  <th style="padding:6px;border:1px solid #333;">Max Pts</th>
                  <th class="pos-col" style="padding:6px;border:1px solid #333;">Best Pos</th>
                  <th class="pos-col" style="padding:6px;border:1px solid #333;">Worst Pos</th>
                </tr>
              </thead>
              <tbody>
        `;
      
        for (const uid of uids) {
          const name  = driverNames[uid] || uid;
          const cur   = champData.finalTotals[uid] || 0;
          const min   = minTotals[uid] || 0;
          const max   = maxTotals[uid] || 0;
          const best  = minFinish[uid] || 1;
          const worst = maxFinish[uid] || 1;
      
          // Current rank equals the column order you passed in (uidsByStandings)
          const currentRank = uids.indexOf(uid) + 1;
          const locked = (best === currentRank && worst === currentRank);
      
          html += `
            <tr${locked ? ' class="locked-row"' : ''}>
              <td class="pos-col" style="padding:6px;border:1px solid #ccc;" title="${locked ? 'Locked at P' + currentRank : 'Current position'}" aria-label="${locked ? 'Locked at P' + currentRank : 'Current position'}">
                ${locked ? '🏁' : currentRank}
              </td>
              <td style="padding:6px;border:1px solid #ccc;text-align:left;">${name}</td>
              <td style="padding:6px;border:1px solid #ccc;">${cur}</td>
              <td style="padding:6px;border:1px solid #ccc;">${min}</td>
              <td style="padding:6px;border:1px solid #ccc;">${max}</td>
              <td class="pos-col" style="padding:6px;border:1px solid #ccc;">${best}</td>
              <td class="pos-col" style="padding:6px;border:1px solid #ccc;">${worst}</td>
            </tr>
          `;
        }
      
        html += `
                </tbody>
            </table>
            </div>
            <div style="font-size:11px;color:#666;margin-top:8px;line-height:1.4;">
            <strong>Legend:</strong><br>
            🏁 = driver is mathematically locked to this position<br>
            <em>Current</em> = points right now<br>
            <em>Min</em> = points if you score only baseline non-attendance points in all remaining events<br>
            <em>Max</em> = points if you win all remaining events and take all your own bonus points<br>
            <em>Best Pos. / Worst Pos.</em> = range of possible finishing positions given Min/Max scenarios
            </div>
        `;
      
        document.getElementById('calcModalBody').innerHTML = html;
      }
      
      
  
    // ---------- Public API ----------
    window.openPointsCalculator = function (champData) {
      if (!champData) { alert('No championship data available yet.'); return; }
  
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
  