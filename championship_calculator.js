// championship_calculator.js
(function () {
  function qs(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let activeComparisonState = null;

  // Bounds use last-place points for the active grid, including DNF/non-attendance.
  // Equal score/win/podium bounds remain unresolved, rather than implying a lock.
  function compareScoreBounds(a, b) {
    return b.total - a.total || b.wins - a.wins || b.podiums - a.podiums;
  }

  function countEventPoints(points, keepEvents) {
    return points.slice().sort((a, b) => b - a).slice(0, keepEvents)
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function currentDriverState(uid, champData) {
    return { uid, eventPointsByEvent: (champData.racePointsPerEvent[uid] || []).slice(),
      addedBonus: 0, wins: Number(champData.winsPerDriver[uid]) || 0,
      podiums: Number(champData.podiumsPerDriver[uid]) || 0 };
  }

  function computeExtremes(champData, advance = () => {}) {
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const stages = getAllRemainingStages(champData);
    const lows = {}, highs = {}, minTotals = {}, maxTotals = {}, minFinish = {}, maxFinish = {};
    uids.forEach(uid => {
      const state = currentDriverState(uid, champData);
      lows[uid] = projectRemainingExtreme(state, uid, champData, stages, false);
      highs[uid] = projectRemainingExtreme(state, uid, champData, stages, true);
      minTotals[uid] = lows[uid].total;
      maxTotals[uid] = highs[uid].total;
      advance(1);
    });
    uids.forEach((uid, index) => {
      minFinish[uid] = stages.length ? 1 + uids.filter(other => other !== uid
        && compareScoreBounds(lows[other], highs[uid]) < 0).length : index + 1;
      advance(1);
      maxFinish[uid] = stages.length ? 1 + uids.filter(other => other !== uid
        && compareScoreBounds(highs[other], lows[uid]) <= 0).length : index + 1;
      advance(1);
    });
    return { minTotals, maxTotals, minFinish, maxFinish,
      remainingIdxs: [...new Set(stages.map(stage => stage.eventIndex))] };
  }

  // ---------- Next race/event calculator ----------
  function availableAwards(event, mode) {
    const awards = [];
    if (mode !== 'race2') {
      if (!event.hasPoleResult) awards.push({ label: 'Pole', race: 0 });
      if (!event.hasFastestLapR1Result) awards.push({ label: 'Race 1 fastest lap', race: 0 });
      if (!event.hasOffPodiumR1Result) awards.push({ label: 'Race 1 off-podium fastest lap', race: 0, offPodium: true });
    }
    if (mode === 'race2' || mode === 'full') {
      const race = mode === 'full' ? 1 : 0;
      if (!event.hasFastestLapR2Result) awards.push({ label: 'Race 2 fastest lap', race });
      if (!event.hasOffPodiumR2Result) awards.push({ label: 'Race 2 off-podium fastest lap', race, offPodium: true });
    }
    return awards;
  }

  function getEventMaximumBonus(event, mode) {
    return availableAwards(event, mode).length;
  }

  function stageFromEvent(event, mode) {
    return {
      ...event,
      eventIndex: event.index,
      mode,
      maximumBonus: getEventMaximumBonus(event, mode),
      race1MaximumBonus: getEventMaximumBonus(event, 'race1')
    };
  }

  function getNextStage(champData) {
    for (const event of (champData.eventDetails || [])) {
      if (!event.hasRace1Results) {
        return stageFromEvent(event, event.special ? 'special' : 'full');
      }

      if (!event.special && !event.hasRace2Results) {
        return stageFromEvent(event, 'race2');
      }
    }
    return null;
  }

  function getStageDescription(stage) {
    if (stage.mode === 'race2') return 'Race 2 remaining';
    if (stage.mode === 'special') return 'Special event · double points';
    return '';
  }

  function getStageMaximumBonus(stage) {
    if (Number.isFinite(stage.maximumBonus)) return stage.maximumBonus;
    if (stage.mode === 'race2') return 2;
    if (stage.mode === 'race1') return 3;
    return stage.mode === 'special' ? 3 : 5;
  }

  function buildOutcomeTemplates(champData, stage) {
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const positions = Array.from({ length: uids.length }, (_, index) => index + 1);
    const pointsMap = champData.positionToPoints || {};
    const pointsFor = position => Number(pointsMap[position]) || 0;
    const outcomes = [];

    if (stage.mode === 'full') {
      positions.forEach(race1Position => {
        positions.forEach(race2Position => {
          outcomes.push({
            positions: [race1Position, race2Position],
            label: `P${race1Position} + P${race2Position}`,
            eventPoints: pointsFor(race1Position) + pointsFor(race2Position),
            winsAdded: Number(race1Position === 1) + Number(race2Position === 1),
            podiumsAdded: Number(race1Position <= 3) + Number(race2Position <= 3)
          });
        });
      });
    } else {
      positions.forEach(position => {
        const doublePoints = stage.mode === 'special';
        outcomes.push({
          positions: [position],
          label: stage.mode === 'race2' ? `Race 2 P${position}` : `P${position}`,
          eventPoints: pointsFor(position) * (doublePoints ? 2 : 1),
          winsAdded: Number(position === 1),
          podiumsAdded: Number(position <= 3)
        });
      });
    }

    return outcomes.sort((a, b) =>
      b.eventPoints - a.eventPoints
      || a.positions.reduce((sum, value) => sum + value, 0)
        - b.positions.reduce((sum, value) => sum + value, 0)
    );
  }

  function projectDriverState(uid, outcome, addedBonus, champData, stage) {
    const eventPoints = (champData.racePointsPerEvent[uid] || []).slice();
    while (eventPoints.length < champData.eventCount) eventPoints.push(0);

    const currentEventPoints = Number(eventPoints[stage.eventIndex]) || 0;
    eventPoints[stage.eventIndex] = stage.mode === 'race2'
      ? currentEventPoints + outcome.eventPoints
      : outcome.eventPoints;

    const countedFinishingPoints = countEventPoints(eventPoints, champData.keepEvents);
    const total = countedFinishingPoints
      + (Number(champData.bonusPointsPerDriver[uid]) || 0)
      + addedBonus;

    return {
      uid,
      total,
      wins: (Number(champData.winsPerDriver[uid]) || 0) + outcome.winsAdded,
      podiums: (Number(champData.podiumsPerDriver[uid]) || 0) + outcome.podiumsAdded,
      eventPoints: eventPoints[stage.eventIndex],
      eventPointsByEvent: eventPoints,
      addedBonus,
      netGain: total - (Number(champData.finalTotals[uid]) || 0),
      outcome
    };
  }

  function compareProjectedStates(a, b, champData) {
    if (b.total !== a.total) return b.total - a.total;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.podiums !== a.podiums) return b.podiums - a.podiums;
    return a.uid.localeCompare(b.uid);
  }

  function rankForStateList(states, targetUid, champData) {
    return states.slice()
      .sort((a, b) => compareProjectedStates(a, b, champData))
      .findIndex(state => state.uid === targetUid) + 1;
  }

  // Unique finisher positions, followed by a shared-last position for DNS/DNF.
  // n-1 finishers has the same numerical scores as a full grid, so omit that duplicate.
  function* classifiedOpponents(n, targetPosition) {
    for (let finishers = 0; finishers <= n; finishers++) {
      if (finishers === n - 1 || targetPosition > Math.min(n, finishers + 1)) continue;
      const slots = Array.from({ length: finishers }, (_, i) => i + 1)
        .filter(position => position !== targetPosition);
      const values = Array(n - 1).fill(finishers + 1);
      const used = Array(n - 1).fill(false);
      function* assign(index) {
        if (index === slots.length) { yield values; return; }
        for (let driver = 0; driver < values.length; driver++) {
          if (used[driver]) continue;
          used[driver] = true;
          values[driver] = slots[index];
          yield* assign(index + 1);
          values[driver] = finishers + 1;
          used[driver] = false;
        }
      }
      yield* assign(0);
    }
  }

  function computeValidStageRankRange(champData, stage, targetUid, advance = () => {}) {
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const n = uids.length;
    if (!n || n > (stage.mode === 'full' ? 6 : 10) || !uids.includes(targetUid)) return null;
    const maximumBonus = getStageMaximumBonus(stage);
    const awards = availableAwards(stage, stage.mode).slice(0, maximumBonus);
    const outcomes = buildOutcomeTemplates(champData, stage).sort((a, b) =>
      b.positions[0] - a.positions[0] || (b.positions[1] || 0) - (a.positions[1] || 0));
    const opponents = uids.filter(uid => uid !== targetUid);
    const currentRank = uids.indexOf(targetUid) + 1;
    const range = { bestRank: n, worstRank: 1 };
    let promotion = null;
    const cache = {};
    uids.forEach(uid => {
      cache[uid] = new Map(outcomes.map(outcome => [outcome.positions.join(','),
        Array.from({ length: maximumBonus + 1 }, (_, bonus) =>
          projectDriverState(uid, outcome, bonus, champData, stage))]));
    });
    const bitCount = mask => {
      let count = 0;
      while (mask) { mask &= mask - 1; count++; }
      return count;
    };
    const subsets = mask => {
      const result = [0];
      for (let sub = mask; sub; sub = (sub - 1) & mask) result.push(sub);
      return result.sort((a, b) => bitCount(a) - bitCount(b));
    };

    function evaluate(targetOutcome, race1, race2) {
      const states = [cache[targetUid].get(targetOutcome.positions.join(',')),
        ...opponents.map((uid, i) => cache[uid].get(stage.mode === 'full'
          ? `${race1[i]},${race2[i]}` : `${race1[i]}`))];
      if (stage.mode !== 'full' && !promotion) {
        const target = states[0][0];
        const field = states.map(values => values[0]).sort((a, b) => compareProjectedStates(a, b, champData));
        const rank = field.findIndex(value => value.uid === targetUid) + 1;
        if (rank < currentRank) {
          const rivalConditions = opponents.flatMap(uid => {
            const index = uids.indexOf(uid);
            const actual = field.find(value => value.uid === uid);
            const passed = index < currentRank - 1 && compareProjectedStates(actual, target, champData) > 0;
            const dangerThreshold = index > currentRank - 1
              ? outcomes.slice().sort((a, b) => a.positions[0] - b.positions[0]).find(selectedOutcome =>
                outcomes.some(rivalOutcome => {
                  // Equal classifications are possible only as shared last, below Pn.
                  if (selectedOutcome.positions[0] === n && rivalOutcome.positions[0] === n) return false;
                  return compareProjectedStates(projectDriverState(uid, rivalOutcome, 0, champData, stage),
                    projectDriverState(targetUid, selectedOutcome, 0, champData, stage), champData) < 0;
                })) : null;
            if (!passed && !dangerThreshold) return [];
            const threshold = outcomes.slice().sort((a, b) => a.positions[0] - b.positions[0]).find(outcome =>
              compareProjectedStates(projectDriverState(uid, outcome, 0, champData, stage), target, champData) > 0);
            return [{ uid, kind: passed ? 'jump' : 'threat', dangerFinish: dangerThreshold?.positions[0] || null, finish: compareProjectedStates(actual, target, champData) > 0 ? threshold?.positions[0] || null : null,
              exampleFinish: actual.outcome.positions[0] }];
          });
          promotion = { finish: targetOutcome.positions[0], rank, rivalConditions,
            field: field.map((value, i) => ({ uid: value.uid, rank: i + 1, total: value.total,
              finish: value.outcome.positions[0], awards: [] })) };
        }
      }
      const eligible = states.map(values => awards.reduce((mask, award, index) =>
        !award.offPodium || values[0].outcome.positions[award.race] > 3 ? mask | (1 << index) : mask, 0));
      // No off-podium award is possible when nobody is classified outside the podium.
      const all = eligible.reduce((mask, value) => mask | value, 0);
      const targetBest = states[0][bitCount(eligible[0])];
      const bestBound = 1 + states.slice(1).filter(values =>
        compareProjectedStates(values[0], targetBest, champData) < 0).length;
      const costs = states.slice(1).map((values, i) => {
        for (let bonus = 0; bonus <= bitCount(eligible[i + 1]); bonus++) {
          if (compareProjectedStates(values[bonus], states[0][0], champData) < 0) return bonus;
        }
        return Infinity;
      }).sort((a, b) => a - b);
      let pool = bitCount(all), worstBound = 1;
      costs.forEach(cost => { if (cost <= pool) { pool -= cost; worstBound++; } });
      if (bestBound < range.bestRank || worstBound > range.worstRank) {
        // Assign each distinct award once. DP merges allocations with the same used
        // awards, retaining the lowest/highest number of rivals ahead of the target.
        for (const targetMask of subsets(eligible[0])) {
          const target = states[0][bitCount(targetMask)];
          let dp = new Map([[targetMask, { min: 0, max: 0, allocation: [] }]]);
          for (let i = 1; i < states.length; i++) {
            const next = new Map();
            for (const [used, value] of dp) {
              for (const mask of subsets(eligible[i] & ~used)) {
                const ahead = Number(compareProjectedStates(states[i][bitCount(mask)], target, champData) < 0);
                const key = used | mask, min = value.min + ahead, max = value.max + ahead;
                const old = next.get(key);
                if (!old) next.set(key, { min, max, allocation: [...value.allocation, mask] });
                else {
                  if (min < old.min) { old.min = min; old.allocation = [...value.allocation, mask]; }
                  old.max = Math.max(old.max, max);
                }
              }
            }
            dp = next;
          }
          const result = dp.get(all);
          if (!result) continue;
          range.bestRank = Math.min(range.bestRank, result.min + 1);
          range.worstRank = Math.max(range.worstRank, result.max + 1);

        }
      }
      advance(1);
    }

    search:
    for (const outcome of outcomes) {
      for (const first of classifiedOpponents(n, outcome.positions[0])) {
        if (stage.mode === 'full') {
          for (const second of classifiedOpponents(n, outcome.positions[1])) {
            evaluate(outcome, first, second);
            if (range.bestRank === 1 && range.worstRank === n) break search;
          }
        } else {
          evaluate(outcome, first, null);
          if (range.bestRank === 1 && range.worstRank === n
            && (currentRank === 1 || promotion)) break search;
        }
      }
    }
    return promotion ? { ...range, promotion } : range;
  }

  function computeNextStageAnalysis(champData, advance = () => {}) {
    const stage = getNextStage(champData);
    if (!stage) return { stage: null, forecasts: {} };

    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const templates = buildOutcomeTemplates(champData, stage);
    const maximumBonus = getStageMaximumBonus(stage);
    const forecasts = {};

    uids.forEach(uid => {
      const noBonusStates = templates.map(outcome =>
        projectDriverState(uid, outcome, 0, champData, stage)
      );
      const maximumBonusStates = templates.map(outcome =>
        projectDriverState(uid, outcome, maximumBonus, champData, stage)
      );
      const bestStates = maximumBonusStates.slice()
        .sort((a, b) => compareProjectedStates(a, b, champData));
      const worstStates = noBonusStates.slice()
        .sort((a, b) => compareProjectedStates(a, b, champData));

      forecasts[uid] = {
        noBonusStates,
        bestState: bestStates[0],
        worstState: worstStates[worstStates.length - 1]
      };
      advance(1);
    });

    uids.forEach((uid, currentIndex) => {
      const bestField = uids.map(otherUid =>
        otherUid === uid ? forecasts[uid].bestState : forecasts[otherUid].worstState
      );
      const worstField = uids.map(otherUid =>
        otherUid === uid ? forecasts[uid].worstState : forecasts[otherUid].bestState
      );
      const bestRank = rankForStateList(bestField, uid, champData);
      const worstRank = rankForStateList(worstField, uid, champData);
      const aboveUid = currentIndex > 0 ? uids[currentIndex - 1] : null;
      const belowUid = currentIndex < uids.length - 1 ? uids[currentIndex + 1] : null;

      forecasts[uid].currentRank = currentIndex + 1;
      forecasts[uid].bestRank = bestRank;
      forecasts[uid].worstRank = worstRank;
      forecasts[uid].aboveUid = aboveUid;
      forecasts[uid].belowUid = belowUid;
      advance(1);
    });

    return {
      stage,
      forecasts,
      maximumBonus,
      individualRanges: {},
      validRangesComputed: {}
    };
  }

  async function ensureValidRangesForDriver(uid, champData, analysis, onProgress) {
    if (!analysis.stage || analysis.validRangesComputed[uid]) return;
    const result = await runCalculation({ type: 'ranges', uid, champData, stage: analysis.stage }, onProgress);
    analysis.eventRanges ||= {};
    analysis.eventRanges[uid] = result.eventRange;
    analysis.individualRanges[uid] = result.individualRange;
    if (result.eventRange) Object.assign(analysis.forecasts[uid], result.eventRange);
    analysis.validRangesComputed[uid] = true;
  }

  function getNextIndividualRaceStage(eventStage) {
    if (eventStage.mode !== 'full') return eventStage;
    return {
      ...eventStage,
      mode: 'race1',
      maximumBonus: Number.isFinite(eventStage.race1MaximumBonus)
        ? eventStage.race1MaximumBonus
        : 3
    };
  }

  function getNextIndividualRaceLabel(eventStage) {
    if (eventStage.mode === 'race2') return 'Race 2';
    if (eventStage.mode === 'special') return 'Special race';
    return 'Race 1';
  }

  function formatPointsGap(gap) {
    if (gap > 0) return `+${gap}`;
    if (gap < 0) return `−${Math.abs(gap)}`;
    return '0';
  }

  function formatRankRange(bestRank, worstRank) {
    return `P${bestRank}${bestRank === worstRank ? '' : `–P${worstRank}`}`;
  }

  function getStagesAfterNextRace(champData, nextRaceStage) {
    const stages = [];

    (champData.eventDetails || []).forEach(event => {
      if (event.index < nextRaceStage.eventIndex) return;

      if (event.index === nextRaceStage.eventIndex) {
        if (nextRaceStage.mode === 'race1' && !event.special) {
          stages.push(stageFromEvent(event, 'race2'));
        }
        return;
      }

      if (!event.hasRace1Results) {
        stages.push(stageFromEvent(event, event.special ? 'special' : 'full'));
      } else if (!event.special && !event.hasRace2Results) {
        stages.push(stageFromEvent(event, 'race2'));
      }
    });

    return stages;
  }

  function getAllRemainingStages(champData) {
    const stages = [];

    (champData.eventDetails || []).forEach(event => {
      if (!event.hasRace1Results) {
        stages.push(stageFromEvent(event, event.special ? 'special' : 'full'));
      } else if (!event.special && !event.hasRace2Results) {
        stages.push(stageFromEvent(event, 'race2'));
      }
    });

    return stages;
  }

  function projectRemainingExtreme(state, uid, champData, remainingStages, useMaximum) {
    const eventPoints = state.eventPointsByEvent.slice();
    let addedBonus = state.addedBonus;
    let wins = state.wins;
    let podiums = state.podiums;

    remainingStages.forEach(stage => {
      const races = stage.mode === 'full' ? 2 : 1;
      const multiplier = stage.mode === 'special' ? 2 : races;
      const lastPlace = (champData.uidsByStandings || Object.keys(champData.driverNames || {})).length;
      const outcome = { eventPoints: (Number(champData.positionToPoints[useMaximum ? 1 : lastPlace]) || 0) * multiplier,
        winsAdded: useMaximum ? races : 0, podiumsAdded: useMaximum ? races : 0 };

      const currentEventPoints = Number(eventPoints[stage.eventIndex]) || 0;
      eventPoints[stage.eventIndex] = stage.mode === 'race2'
        ? currentEventPoints + outcome.eventPoints
        : outcome.eventPoints;
      wins += outcome.winsAdded;
      podiums += outcome.podiumsAdded;
      if (useMaximum) addedBonus += getStageMaximumBonus(stage);
    });

    const countedFinishingPoints = countEventPoints(eventPoints, champData.keepEvents);

    return {
      uid,
      total: countedFinishingPoints
        + (Number(champData.bonusPointsPerDriver[uid]) || 0)
        + addedBonus,
      wins,
      podiums
    };
  }

  function formatFinishCondition(positions) {
    const sorted = positions.slice().sort((a, b) => a - b);
    if (sorted.length === 1) return `P${sorted[0]}`;

    const startsAtWin = sorted[0] === 1;
    const contiguous = sorted.every((position, index) =>
      index === 0 || position === sorted[index - 1] + 1
    );
    if (startsAtWin && contiguous) return `P${sorted[sorted.length - 1]} or better`;
    if (contiguous) return `P${sorted[0]}–P${sorted[sorted.length - 1]}`;
    return sorted.map(position => `P${position}`).join(', ');
  }

  function isCurrentPositionLocked(uid, currentRank, champData) {
    const bounds = computeExtremes(champData);
    return bounds.minFinish[uid] === currentRank && bounds.maxFinish[uid] === currentRank;
  }

  function computeSingleRaceClinchingScenarios(champData, analysis, advance = () => {}) {
    if (!analysis.stage) return [];

    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const raceStage = getNextIndividualRaceStage(analysis.stage);
    const outcomes = buildOutcomeTemplates(champData, raceStage);
    const maximumBonus = getStageMaximumBonus(raceStage);
    const remainingStages = getStagesAfterNextRace(champData, raceStage);
    const scenarios = [];

    uids.forEach((uid, currentIndex) => {
      const currentRank = currentIndex + 1;
      if (isCurrentPositionLocked(uid, currentRank, champData)) {
        advance(outcomes.length);
        return;
      }

      const lockingPositions = [];
      outcomes.forEach(targetOutcome => {
        const targetPosition = targetOutcome.positions[0];
        const targetWorst = projectRemainingExtreme(
          projectDriverState(uid, targetOutcome, 0, champData, raceStage),
          uid, champData, remainingStages, false
        );
        const targetBest = projectRemainingExtreme(
          projectDriverState(uid, targetOutcome, maximumBonus, champData, raceStage),
          uid, champData, remainingStages, true
        );

        const bestField = [targetBest];
        const worstField = [targetWorst];

        uids.forEach(otherUid => {
          if (otherUid === uid) return;

          // Shared-last classifications may put several drivers in the same position.
          const rivalBestOutcome = outcomes[0];
          const rivalWorstOutcome = outcomes[outcomes.length - 1];
          if (!rivalBestOutcome || !rivalWorstOutcome) return;

          bestField.push(projectRemainingExtreme(
            projectDriverState(otherUid, rivalWorstOutcome, 0, champData, raceStage),
            otherUid, champData, remainingStages, false
          ));
          worstField.push(projectRemainingExtreme(
            projectDriverState(otherUid, rivalBestOutcome, maximumBonus, champData, raceStage),
            otherUid, champData, remainingStages, true
          ));
        });

        const bestRank = 1 + bestField.filter(state => state.uid !== uid
          && compareScoreBounds(state, targetBest) < 0).length;
        const worstRank = 1 + worstField.filter(state => state.uid !== uid
          && compareScoreBounds(state, targetWorst) <= 0).length;
        if (bestRank === currentRank && worstRank === currentRank) {
          lockingPositions.push(targetPosition);
        }
        advance(1);
      });

      if (lockingPositions.length) {
        scenarios.push({
          type: 'race',
          uid,
          rank: currentRank,
          finishCondition: formatFinishCondition(lockingPositions)
        });
      }
    });

    return scenarios;
  }

  function renderClinchingScenarios(champData, analysis, advance = () => {}) {
    const scenarios = computeSingleRaceClinchingScenarios(champData, analysis, advance);
    if (!scenarios.length) return '';

    const raceLabel = getNextIndividualRaceLabel(analysis.stage);
    const items = scenarios.map(scenario => {
      const name = champData.driverNames[scenario.uid] || scenario.uid;
      return `<li>If <strong>${escapeHtml(name)}</strong> finishes ${escapeHtml(scenario.finishCondition)} in ${escapeHtml(raceLabel)}, P${scenario.rank} is locked in.</li>`;
    }).join('');

    return `
      <section class="clinching-scenarios">
        <h4>Possible championship clinches</h4>
        <ul>${items}</ul>
      </section>
    `;
  }

  function buildComparisonMatrix(selectedUid, opponentUid, relation, champData, eventStage) {
    if (!opponentUid) return '';

    const raceStage = getNextIndividualRaceStage(eventStage);
    const outcomes = buildOutcomeTemplates(champData, raceStage);
    const maximumBonus = getStageMaximumBonus(raceStage);
    const selectedName = champData.driverNames[selectedUid] || selectedUid;
    const opponentName = champData.driverNames[opponentUid] || opponentUid;
    const order = champData.uidsByStandings || [];
    const opponentRank = order.indexOf(opponentUid) + 1;

    const headerCells = outcomes.map(outcome =>
      `<th scope="col">P${outcome.positions[0]}</th>`
    ).join('');

    const rows = outcomes.map(selectedOutcome => {
      const cells = outcomes.map(opponentOutcome => {
        const selectedPosition = selectedOutcome.positions[0];
        const opponentPosition = opponentOutcome.positions[0];

        if (selectedPosition === opponentPosition && selectedPosition === outcomes.length) {
          return '<td class="matrix-impossible" aria-label="Two drivers cannot both be last in a full grid">—</td>';
        }

        const selectedNoBonus = projectDriverState(
          selectedUid, selectedOutcome, 0, champData, raceStage
        );
        const selectedWithBonus = projectDriverState(
          selectedUid, selectedOutcome, availableAwards(raceStage, raceStage.mode).slice(0, maximumBonus).filter(award => !award.offPodium || selectedPosition > 3).length, champData, raceStage
        );
        const opponentNoBonus = projectDriverState(
          opponentUid, opponentOutcome, 0, champData, raceStage
        );
        const opponentWithBonus = projectDriverState(
          opponentUid, opponentOutcome, availableAwards(raceStage, raceStage.mode).slice(0, maximumBonus).filter(award => !award.offPodium || opponentPosition > 3).length, champData, raceStage
        );
        const gap = selectedNoBonus.total - opponentNoBonus.total;
        const alwaysAhead = compareProjectedStates(selectedNoBonus, opponentWithBonus, champData) < 0;
        const alwaysBehind = compareProjectedStates(selectedWithBonus, opponentNoBonus, champData) > 0;

        let className;
        let outcomeText;
        let marker = '';
        if (selectedNoBonus.total === opponentNoBonus.total || (!alwaysAhead && !alwaysBehind)) {
          className = 'matrix-uncertain';
          outcomeText = 'bonus-sensitive';
          marker = '*';
        } else if (alwaysAhead) {
          className = 'matrix-ahead';
          outcomeText = `${selectedName} ahead`;
        } else {
          className = 'matrix-behind';
          outcomeText = `${selectedName} behind`;
        }

        const label = `${selectedPosition === opponentPosition ? 'Shared-last result. ' : ''}${selectedName} P${selectedPosition}, ${opponentName} P${opponentPosition}: ${formatPointsGap(gap)} points, ${outcomeText}`;
        return `<td class="${className}" aria-label="${escapeHtml(label)}">${formatPointsGap(gap)}${marker}</td>`;
      }).join('');

      return `<tr><th scope="row">P${selectedOutcome.positions[0]}</th>${cells}</tr>`;
    }).join('');

    return `
      <section class="scenario-matrix-block">
        <h5>${relation} · P${opponentRank} ${escapeHtml(opponentName)}</h5>
        <div class="scenario-matrix-axis">${escapeHtml(opponentName)} finish →</div>
        <div class="scenario-matrix-scroll">
          <table class="scenario-matrix-table">
            <thead><tr><th>${escapeHtml(selectedName)} ↓</th>${headerCells}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function updateCompareButtons(champData, analysis) {
    const order = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const state = activeComparisonState;

    document.querySelectorAll('#calcModalBody .calc-compare-button').forEach(button => {
      const targetUid = button.dataset.compareUid;
      const isAlreadyShown = state && (
        targetUid === state.uid
        || targetUid === state.aheadUid
        || targetUid === state.behindUid
      );
      button.hidden = !state || !analysis.stage || isAlreadyShown;

      if (state && !button.hidden) {
        const selectedName = champData.driverNames[state.uid] || state.uid;
        const targetName = champData.driverNames[targetUid] || targetUid;
        const targetRank = order.indexOf(targetUid) + 1;
        button.setAttribute(
          'aria-label',
          `Compare ${selectedName} with P${targetRank} ${targetName}`
        );
      }
    });
  }

  function setPrimaryComparisonDriver(uid, analysis) {
    const forecast = analysis.forecasts[uid] || {};
    activeComparisonState = {
      uid,
      aheadUid: forecast.aboveUid || null,
      behindUid: forecast.belowUid || null
    };
  }

  function compareWithDriver(targetUid, champData, analysis) {
    if (!activeComparisonState || targetUid === activeComparisonState.uid) return;

    const order = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const selectedIndex = order.indexOf(activeComparisonState.uid);
    const targetIndex = order.indexOf(targetUid);
    if (selectedIndex < 0 || targetIndex < 0) return;

    if (targetIndex < selectedIndex) {
      activeComparisonState.aheadUid = targetUid;
    } else {
      activeComparisonState.behindUid = targetUid;
    }

    renderNextRacePanel(activeComparisonState.uid, champData, analysis);
  }

  function renderPromotionExample(uid, champData, analysis) {
    if ((champData.uidsByStandings || []).indexOf(uid) === 0) return '';
    const range = analysis.individualRanges[uid];
    if (!range) return '';
    const example = range.promotion;
    if (!example) return '<p class="scenario-promotion">No next-race move up found without bonus points.</p>';
    const rivals = example.rivalConditions || [];
    const ahead = rivals.filter(rival => rival.kind === 'jump').map(rival =>
      `<li>${escapeHtml(champData.driverNames[rival.uid] || rival.uid)}: P${rival.finish} or lower.</li>`).join('');
    const order = champData.uidsByStandings || [];
    const hasDriversBehind = order.indexOf(uid) < order.length - 1;
    const dangerPositions = rivals.filter(rival => rival.kind === 'threat').map(rival => rival.dangerFinish);
    const safeFinish = dangerPositions.length ? Math.min(...dangerPositions) - 1 : order.length;
    const safetyText = safeFinish > 0
      ? `Safe from drivers behind you if you finish P${safeFinish} or higher`
      : 'No finishing position guarantees staying ahead of every driver behind you';
    return `<section class="scenario-promotion">
      <h4>Lowest finish to move up to P${example.rank}: P${example.finish}</h4>
      ${ahead ? `<strong>Drivers ahead you can pass if P${example.finish}</strong><ul>${ahead}</ul>` : ''}
      ${hasDriversBehind ? `<p><strong>${safetyText}</strong></p>` : ''}
    </section>`;
  }

  // ---------- Modal UI ----------
  async function renderNextRacePanel(uid, champData, analysis) {
    const request = ++panelRequest;
    const panel = qs('nextRaceScenarioPanel');
    if (!panel) return;

    document.querySelectorAll('#calcModalBody .calc-driver-button').forEach(button => {
      const isSelected = button.dataset.driverUid === uid;
      button.setAttribute('aria-expanded', String(isSelected));
      const row = button.closest('tr');
      if (row) row.classList.toggle('scenario-selected', isSelected);
    });

    if (!activeComparisonState || activeComparisonState.uid !== uid) {
      setPrimaryComparisonDriver(uid, analysis);
    }
    updateCompareButtons(champData, analysis);

    panel.hidden = false;
    if (!analysis.stage) {
      panel.innerHTML = `
        <h4 style="margin:0;">${escapeHtml(champData.driverNames[uid] || uid)}</h4>
        <p style="margin:8px 0 0;">The season is complete, so there is no next-event scenario to calculate.</p>
      `;
      return;
    }

    if (!analysis.validRangesComputed[uid]) {
      panel.setAttribute('aria-busy', 'true');
      panel.innerHTML = `<div role="status"><p>Calculating race positions for ${escapeHtml(champData.driverNames[uid] || uid)}… <span data-calculation-percent>0%</span></p>
        <progress data-calculation-progress value="0" max="100" aria-label="Race position calculation progress" style="width:100%;height:18px;accent-color:#222;"></progress></div>`;
      panel.scrollIntoView?.({ block: 'nearest' });
      try {
        await ensureValidRangesForDriver(uid, champData, analysis, percent => {
          if (request !== panelRequest) return;
          panel.querySelector('[data-calculation-progress]').value = percent;
          panel.querySelector('[data-calculation-percent]').textContent = `${percent}%`;
        });
      } catch (error) {
        if (request !== panelRequest || error.name === 'AbortError') return;
        panel.removeAttribute('aria-busy');
        showCalculationError(panel, () => renderNextRacePanel(uid, champData, analysis));
        return;
      }
    } else {
      cancelCalculation();
    }
    if (request !== panelRequest) return;
    panel.removeAttribute('aria-busy');
    const forecast = analysis.forecasts[uid];
    const stage = analysis.stage;
    const name = champData.driverNames[uid] || uid;
    const aboveName = forecast.aboveUid ? champData.driverNames[forecast.aboveUid] || forecast.aboveUid : '';
    const belowName = forecast.belowUid ? champData.driverNames[forecast.belowUid] || forecast.belowUid : '';
    const currentTotal = Number(champData.finalTotals[uid]) || 0;
    const individualRange = analysis.individualRanges[uid];
    const eventRange = analysis.eventRanges?.[uid];
    const individualRangeText = individualRange
      ? formatRankRange(individualRange.bestRank, individualRange.worstRank) : 'Unavailable';
    const eventRangeText = eventRange
      ? formatRankRange(eventRange.bestRank, eventRange.worstRank) : 'Unavailable';
    const hasTwoRaceOutlook = stage.mode === 'full';

    let upwardTitle;
    let upwardText;
    if (forecast.currentRank === 1) {
      upwardTitle = 'Hold P1';
      upwardText = forecast.belowUid
        ? `${currentTotal - (Number(champData.finalTotals[forecast.belowUid]) || 0)} pts ahead of ${belowName}.`
        : 'No challenger.';
    } else if (forecast.bestRank < forecast.currentRank) {
      const requiredGain = (Number(champData.finalTotals[forecast.aboveUid]) || 0) - currentTotal + 1;
      upwardTitle = `Next target: P${forecast.currentRank - 1}`;
      upwardText = `Gain ${requiredGain}+ net pts on ${aboveName}.`;
    } else {
      upwardTitle = `P${forecast.currentRank - 1} out of reach`;
      upwardText = `${aboveName} cannot be passed this event.`;
    }

    let downwardTitle;
    let downwardText;
    if (!forecast.belowUid) {
      downwardTitle = 'No position at risk';
      downwardText = 'No driver behind.';
    } else if (forecast.worstRank > forecast.currentRank) {
      const requiredGain = currentTotal - (Number(champData.finalTotals[forecast.belowUid]) || 0) + 1;
      downwardTitle = `P${forecast.currentRank + 1} at risk`;
      downwardText = `${belowName} needs ${requiredGain}+ net pts.`;
    } else {
      downwardTitle = `P${forecast.currentRank} secure`;
      downwardText = `${belowName} cannot pass this event.`;
    }

    const track = window.trackMap?.[stage.trackName]?.full || stage.trackName;
    const stageDescription = getStageDescription(stage);
    const nextRaceLabel = getNextIndividualRaceLabel(stage);
    const aheadMatrix = buildComparisonMatrix(
      uid, activeComparisonState.aheadUid, 'Driver ahead', champData, stage
    );
    const behindMatrix = buildComparisonMatrix(
      uid, activeComparisonState.behindUid, 'Driver behind', champData, stage
    );
    panel.innerHTML = `
      <div class="scenario-heading">
        <div>
          <h4>${escapeHtml(name)} · Next-event outlook</h4>
          <p>${escapeHtml(track)}${stageDescription ? ` · ${escapeHtml(stageDescription)}` : ''}</p>
        </div>
        <div class="scenario-position-flow" aria-label="Current position P${forecast.currentRank}; after next race ${individualRangeText}; after event ${eventRangeText}">
          <div class="scenario-position-step">
            <small>Now</small>
            <span class="scenario-current-position">P${forecast.currentRank}</span>
          </div>
          <span aria-hidden="true">→</span>
          <div class="scenario-position-step">
            <small>${hasTwoRaceOutlook ? 'Next race' : 'After race/event'}</small>
            <strong class="scenario-position-result">${individualRangeText}</strong>
          </div>
          ${hasTwoRaceOutlook ? `
            <span aria-hidden="true">→</span>
            <div class="scenario-position-step">
              <small>After event</small>
              <strong class="scenario-position-result">${eventRangeText}</strong>
            </div>
          ` : ''}
        </div>
      </div>

      ${!individualRange ? '<p>Exact single-race ranges are available for grids of up to 10 drivers.</p>' : ''}
      ${eventRange ? `<div class="scenario-moves">
        <div class="scenario-move">
          <strong>${escapeHtml(upwardTitle)}</strong>
          <span>${escapeHtml(upwardText)}</span>
        </div>
        <div class="scenario-move">
          <strong>${escapeHtml(downwardTitle)}</strong>
          <span>${escapeHtml(downwardText)}</span>
        </div>
      </div>

      ` : ''}
      ${renderPromotionExample(uid, champData, analysis)}
      ${(aheadMatrix || behindMatrix) ? `
        <div class="scenario-matrices">
          <div class="scenario-matrices-heading">
            <strong>Next individual race · ${nextRaceLabel}</strong>
            <div class="scenario-matrix-key" aria-label="Matrix colour key">
              <span><i class="matrix-ahead"></i>Ahead</span>
              <span><i class="matrix-behind"></i>Behind</span>
              <span><i class="matrix-uncertain"></i>* Bonus-sensitive</span>
            </div>
          </div>
          <div class="scenario-matrix-grid">
            ${aheadMatrix}
            ${behindMatrix}
          </div>
        </div>
      ` : ''}
    `;

    if (typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderTable(champData, extremes, nextRaceAnalysis, clinchingScenarios) {
    const { driverNames, uidsByStandings } = champData;
    const uids = uidsByStandings || Object.keys(driverNames || {});
    const { minTotals, maxTotals, minFinish, maxFinish } = extremes;

    let html = `
      <h3 style="margin:0 0 10px 0;">Title Scenarios</h3>
      <p style="margin:0 0 8px 0;">
        Events: <strong>${extremes.remainingIdxs.length} remaining</strong> &nbsp;•&nbsp;
        Drops: <strong>${champData.safeDropRaces}</strong>
      </p>
      <div style="overflow-x:auto;">
        <table class="calc-table" style="border-collapse:collapse; width:100%;">
          <thead>
            <tr>
              <th class="pos-col" style="padding:6px;border:1px solid #333;">Pos</th>
              <th class="driver-name-col" style="padding:6px;border:1px solid #333;text-align:left;">Driver</th>
              <th style="padding:6px;border:1px solid #333;">Current</th>
              <th style="padding:6px;border:1px solid #333;">Min</th>
              <th style="padding:6px;border:1px solid #333;">Max</th>
              <th class="pos-col" style="padding:6px;border:1px solid #333;" title="Best championship position bound">Best<br>Pos</th>
              <th class="pos-col" style="padding:6px;border:1px solid #333;" title="Worst championship position bound">Worst<br>Pos</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const uid of uids) {
      const name = driverNames[uid] || uid;
      const current = champData.finalTotals[uid] || 0;
      const minimum = minTotals[uid] || 0;
      const maximum = maxTotals[uid] || 0;
      const best = minFinish[uid] || 1;
      const worst = maxFinish[uid] || 1;
      const currentRank = uids.indexOf(uid) + 1;
      const locked = best === currentRank && worst === currentRank;

      html += `
        <tr${locked ? ' class="locked-row"' : ''}>
          <td class="pos-col" style="padding:6px;border:1px solid #ccc;" title="${locked ? `Locked at P${currentRank}` : 'Current position'}" aria-label="${locked ? `Locked at P${currentRank}` : 'Current position'}">
            ${locked ? '🏁' : currentRank}
          </td>
          <td class="driver-name-col" style="padding:6px;border:1px solid #ccc;text-align:left;">
            <div class="calc-driver-cell">
              <button type="button" class="calc-driver-button" data-driver-uid="${escapeHtml(uid)}" aria-expanded="false" aria-controls="nextRaceScenarioPanel">${escapeHtml(name)}</button>
              <button type="button" class="calc-compare-button" data-compare-uid="${escapeHtml(uid)}" hidden>Compare</button>
            </div>
          </td>
          <td style="padding:6px;border:1px solid #ccc;">${current}</td>
          <td style="padding:6px;border:1px solid #ccc;">${minimum}</td>
          <td style="padding:6px;border:1px solid #ccc;">${maximum}</td>
          <td class="pos-col" style="padding:6px;border:1px solid #ccc;">${best}</td>
          <td class="pos-col" style="padding:6px;border:1px solid #ccc;">${worst}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
      ${clinchingScenarios}
      <section id="nextRaceScenarioPanel" class="next-race-scenario" aria-live="polite" hidden></section>
    `;

    const modalBody = qs('calcModalBody');
    modalBody.innerHTML = html;
    modalBody.querySelectorAll('.calc-driver-button').forEach(button => {
      button.addEventListener('click', () => {
        setPrimaryComparisonDriver(button.dataset.driverUid, nextRaceAnalysis);
        renderNextRacePanel(button.dataset.driverUid, champData, nextRaceAnalysis);
      });
    });
    modalBody.querySelectorAll('.calc-compare-button').forEach(button => {
      button.addEventListener('click', () => {
        compareWithDriver(button.dataset.compareUid, champData, nextRaceAnalysis);
      });
    });
  }

  // This same script runs in a dedicated worker, without accessing the page.
  if (typeof document === 'undefined') {
    self.onmessage = ({ data }) => {
      try {
        let result;
        const n = (data.champData.uidsByStandings || Object.keys(data.champData.driverNames || {})).length;
        const stage = data.stage || getNextStage(data.champData);
        const factorial = value => value <= 1 ? 1 : value * factorial(value - 1);
        const classificationCount = factorial(n) + Array.from({ length: Math.max(0, n - 1) }, (_, k) =>
          factorial(n) / factorial(n - k)).reduce((sum, count) => sum + count, 0);
        const searchSize = mode => n > (mode === 'full' ? 6 : 10) ? 0
          : classificationCount ** (mode === 'full' ? 2 : 1);
        const eventSize = stage ? searchSize(stage.mode) : 0;
        const individualSize = stage?.mode === 'full' ? searchSize('race1') : 0;
        const total = Math.max(1, data.type === 'ranges' ? eventSize + individualSize
          : (stage ? 5 * n + n * n : 3 * n));
        let completed = 0, lastPercent = 0;
        self.postMessage({ progress: 0 });
        const advance = count => {
          completed += count;
          const percent = Math.min(99, Math.floor(completed * 100 / total));
          if (percent > lastPercent) {
            lastPercent = percent;
            self.postMessage({ progress: percent });
          }
        };
        if (data.type === 'ranges') {
          const eventRange = computeValidStageRankRange(data.champData, stage, data.uid, advance);
          // An early exhaustive-range exit finishes this part of the work.
          advance(eventSize - completed);
          const individualRange = stage.mode === 'full'
            ? computeValidStageRankRange(data.champData, getNextIndividualRaceStage(stage), data.uid, advance)
            : eventRange;
          result = { eventRange, individualRange };
        } else {
          const analysis = computeNextStageAnalysis(data.champData, advance);
          result = { analysis, extremes: computeExtremes(data.champData, advance),
            clinchingScenarios: renderClinchingScenarios(data.champData, analysis, advance) };
        }
        self.postMessage({ progress: 100 });
        self.postMessage({ result });
      } catch (error) {
        self.postMessage({ error: error.message });
      }
    };
    return;
  }

  let calculationWorker = null;
  let rejectCalculation = null;
  let panelRequest = 0;
  let modalRequest = 0;

  function cancelCalculation() {
    calculationWorker?.terminate();
    calculationWorker = null;
    if (rejectCalculation) {
      const error = new Error('Calculation cancelled');
      error.name = 'AbortError';
      rejectCalculation(error);
      rejectCalculation = null;
    }
  }

  function runCalculation(payload, onProgress = () => {}) {
    cancelCalculation();
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker('championship_calculator.js');
        calculationWorker = worker;
        rejectCalculation = reject;
        const finish = () => {
          worker.terminate();
          if (calculationWorker === worker) {
            calculationWorker = null;
            rejectCalculation = null;
          }
        };
        worker.onmessage = ({ data }) => {
          if (calculationWorker !== worker) return;
          if (typeof data.progress === 'number') {
            onProgress(data.progress);
            return;
          }
          finish();
          if (data.error) reject(new Error(data.error));
          else resolve(data.result);
        };
        worker.onerror = () => { finish(); reject(new Error('Calculation failed')); };
        worker.onmessageerror = worker.onerror;
        worker.postMessage(payload);
      } catch (error) {
        calculationWorker?.terminate();
        calculationWorker = null;
        rejectCalculation = null;
        reject(error);
      }
    });
  }

  function showCalculationError(element, retry) {
    element.innerHTML = '<p role="alert">Unable to calculate right now.</p><button type="button">Try again</button>';
    element.querySelector('button').addEventListener('click', retry);
  }

  // ---------- Public API ----------
  window.openPointsCalculator = async function (champData) {
    if (!champData) {
      alert('No championship data available yet.');
      return;
    }
    const request = ++modalRequest;
    ++panelRequest;
    activeComparisonState = null;
    const body = qs('calcModalBody');
    qs('calcModal').style.display = 'flex';
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = `<div role="status">
      <p>Calculating title scenarios… <span data-calculation-percent>0%</span></p>
      <progress data-calculation-progress value="0" max="100" aria-label="Title scenario calculation progress" style="width:100%;height:18px;accent-color:#222;"></progress>
    </div>`;
    try {
      const result = await runCalculation({ type: 'overview', champData }, percent => {
        if (request !== modalRequest) return;
        body.querySelector('[data-calculation-progress]').value = percent;
        body.querySelector('[data-calculation-percent]').textContent = `${percent}%`;
      });
      if (request !== modalRequest) return;
      body.removeAttribute('aria-busy');
      renderTable(champData, result.extremes, result.analysis, result.clinchingScenarios);
    } catch (error) {
      if (request !== modalRequest || error.name === 'AbortError') return;
      body.removeAttribute('aria-busy');
      showCalculationError(body, () => window.openPointsCalculator(champData));
    }
  };

  window.closePointsCalculator = function () {
    ++modalRequest;
    ++panelRequest;
    cancelCalculation();
    const modal = qs('calcModal');
    if (modal) modal.style.display = 'none';
  };

  document.addEventListener('click', event => {
    const modal = qs('calcModal');
    if (!modal || modal.style.display !== 'flex') return;
    if (event.target === modal) window.closePointsCalculator();
  });
})();
