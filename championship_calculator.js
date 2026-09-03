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

  // These baselines are only used by the existing season-long rough estimate.
  const NON_ATTEND_POINTS_NORMAL = 10;
  const NON_ATTEND_POINTS_SPECIAL = 10;
  let activeComparisonState = null;

  // ---------- Existing season-long extremes calculator ----------
  function getRemainingEventIndexes(champData) {
    const { eventCount, racePointsPerEvent } = champData;
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const remaining = [];

    for (let index = 0; index < eventCount; index++) {
      const hasPoints = uids.some(uid => Number((racePointsPerEvent[uid] || [])[index]) > 0);
      if (!hasPoints) remaining.push(index);
    }
    return remaining;
  }

  function isSpecialIndex(index, champData) {
    return (champData.specialEventIndexes || []).includes(index);
  }

  function maxEventFinishingPointsForIndex() { return 40; }

  function minEventFinishingPointsForIndex(index, champData) {
    return isSpecialIndex(index, champData)
      ? NON_ATTEND_POINTS_SPECIAL
      : NON_ATTEND_POINTS_NORMAL;
  }

  function maxEventBonusForIndex(index, champData) {
    return isSpecialIndex(index, champData) ? 2 : 3;
  }

  function computeExtremes(champData) {
    const {
      eventCount, keepEvents, driverNames,
      racePointsPerEvent, bonusPointsPerDriver,
      uidsByStandings
    } = champData;
    const uids = uidsByStandings || Object.keys(driverNames || {});
    const remainingIndexes = getRemainingEventIndexes(champData);
    const minTotals = {};
    const maxTotals = {};
    const minFinish = {};
    const maxFinish = {};
    const finishingMin = {};
    const finishingMax = {};
    const bonusMax = {};

    for (const uid of uids) {
      const base = (racePointsPerEvent[uid] || []).slice();
      while (base.length < eventCount) base.push(0);

      const hypotheticalMaximum = base.map((value, index) =>
        remainingIndexes.includes(index)
          ? maxEventFinishingPointsForIndex(index, champData)
          : (Number(value) || 0)
      );
      finishingMax[uid] = hypotheticalMaximum
        .slice().sort((a, b) => b - a).slice(0, keepEvents)
        .reduce((sum, value) => sum + value, 0);

      const hypotheticalMinimum = base.map((value, index) =>
        remainingIndexes.includes(index)
          ? minEventFinishingPointsForIndex(index, champData)
          : (Number(value) || 0)
      );
      finishingMin[uid] = hypotheticalMinimum
        .slice().sort((a, b) => b - a).slice(0, keepEvents)
        .reduce((sum, value) => sum + value, 0);

      const currentBonus = bonusPointsPerDriver[uid] || 0;
      const availableBonus = remainingIndexes.reduce(
        (sum, index) => sum + maxEventBonusForIndex(index, champData), 0
      );
      bonusMax[uid] = currentBonus + availableBonus;
      minTotals[uid] = finishingMin[uid] + currentBonus;
      maxTotals[uid] = finishingMax[uid] + bonusMax[uid];
    }

    for (const target of uids) {
      const scores = uids.map(uid => ({
        uid,
        score: uid === target ? maxTotals[target] : minTotals[uid]
      }));
      scores.sort((a, b) => b.score - a.score || uids.indexOf(a.uid) - uids.indexOf(b.uid));
      minFinish[target] = scores.findIndex(score => score.uid === target) + 1;
    }

    for (const target of uids) {
      const scores = uids.map(uid => ({
        uid,
        score: uid === target ? minTotals[target] : maxTotals[uid]
      }));
      scores.sort((a, b) => b.score - a.score || uids.indexOf(a.uid) - uids.indexOf(b.uid));
      maxFinish[target] = scores.findIndex(score => score.uid === target) + 1;
    }

    return {
      minTotals, maxTotals, finishingMin, finishingMax,
      bonusMax, minFinish, maxFinish, remainingIdxs: remainingIndexes
    };
  }

  // ---------- Next race/event calculator ----------
  function getEventMaximumBonus(event, mode) {
    const pole = event.hasPoleResult ? 0 : 1;
    const fastestLapR1 = event.hasFastestLapR1Result ? 0 : 1;
    const fastestLapR2 = event.hasFastestLapR2Result ? 0 : 1;

    if (mode === 'race1') return pole + fastestLapR1;
    if (mode === 'race2') return fastestLapR2;
    if (mode === 'special') return pole + fastestLapR1;
    return pole + fastestLapR1 + fastestLapR2;
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
    if (stage.mode === 'race2') return 1;
    if (stage.mode === 'race1') return 2;
    return stage.mode === 'special' ? 2 : 3;
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

    const countedFinishingPoints = eventPoints
      .slice().sort((a, b) => b - a).slice(0, champData.keepEvents)
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
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
    const order = champData.uidsByStandings || [];
    return order.indexOf(a.uid) - order.indexOf(b.uid);
  }

  function rankForStateList(states, targetUid, champData) {
    return states.slice()
      .sort((a, b) => compareProjectedStates(a, b, champData))
      .findIndex(state => state.uid === targetUid) + 1;
  }

  function buildPositionPermutations(inputValues) {
    const values = inputValues.slice();
    const permutations = [];

    function permute(start) {
      if (start === values.length) {
        permutations.push(values.slice());
        return;
      }

      for (let index = start; index < values.length; index += 1) {
        [values[start], values[index]] = [values[index], values[start]];
        permute(start + 1);
        [values[start], values[index]] = [values[index], values[start]];
      }
    }

    permute(0);
    return permutations;
  }

  function computeValidStageRankRange(champData, stage, targetUid) {
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const driverCount = uids.length;
    if (!driverCount || driverCount > 6 || !uids.includes(targetUid)) return null;

    const outcomes = buildOutcomeTemplates(champData, stage);
    const maximumBonus = getStageMaximumBonus(stage);
    const stateCache = {};
    const opponents = uids.filter(uid => uid !== targetUid);
    const range = { bestRank: driverCount, worstRank: 1 };
    const permutationCache = new Map();

    uids.forEach(uid => {
      stateCache[uid] = new Map();
      outcomes.forEach(outcome => {
        const states = [];
        for (let bonus = 0; bonus <= maximumBonus; bonus += 1) {
          states.push(projectDriverState(uid, outcome, bonus, champData, stage));
        }
        stateCache[uid].set(outcome.positions.join(','), states);
      });
    });

    function permutationsWithout(position) {
      if (!permutationCache.has(position)) {
        const remainingPositions = Array.from(
          { length: driverCount }, (_, index) => index + 1
        ).filter(value => value !== position);
        permutationCache.set(position, buildPositionPermutations(remainingPositions));
      }
      return permutationCache.get(position);
    }

    function evaluateClassification(targetStates, race1Positions, race2Positions) {
      const opponentStates = opponents.map((uid, index) => {
        const key = stage.mode === 'full'
          ? `${race1Positions[index]},${race2Positions[index]}`
          : `${race1Positions[index]}`;
        return stateCache[uid].get(key);
      });

      const targetBest = targetStates[maximumBonus];
      let bestRank = 1;
      opponentStates.forEach(states => {
        if (compareProjectedStates(states[0], targetBest, champData) < 0) bestRank += 1;
      });

      const targetWorst = targetStates[0];
      const bonusCosts = opponentStates.map(states => {
        for (let bonus = 0; bonus <= maximumBonus; bonus += 1) {
          if (compareProjectedStates(states[bonus], targetWorst, champData) < 0) return bonus;
        }
        return Infinity;
      }).sort((a, b) => a - b);

      let remainingBonus = maximumBonus;
      let driversAhead = 0;
      bonusCosts.forEach(cost => {
        if (cost <= remainingBonus) {
          driversAhead += 1;
          remainingBonus -= cost;
        }
      });

      range.bestRank = Math.min(range.bestRank, bestRank);
      range.worstRank = Math.max(range.worstRank, driversAhead + 1);
    }

    targetOutcomeSearch:
    for (const targetOutcome of outcomes) {
      const targetStates = stateCache[targetUid].get(targetOutcome.positions.join(','));
      const race1Permutations = permutationsWithout(targetOutcome.positions[0]);

      if (stage.mode === 'full') {
        const race2Permutations = permutationsWithout(targetOutcome.positions[1]);
        for (const race1Positions of race1Permutations) {
          for (const race2Positions of race2Permutations) {
            evaluateClassification(targetStates, race1Positions, race2Positions);
            if (range.bestRank === 1 && range.worstRank === driverCount) {
              break targetOutcomeSearch;
            }
          }
        }
      } else {
        for (const racePositions of race1Permutations) {
          evaluateClassification(targetStates, racePositions, null);
          if (range.bestRank === 1 && range.worstRank === driverCount) {
            break targetOutcomeSearch;
          }
        }
      }
    }

    return range;
  }

  function computeNextStageAnalysis(champData) {
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
    });

    return {
      stage,
      forecasts,
      maximumBonus,
      individualRanges: {},
      validRangesComputed: {}
    };
  }

  function ensureValidRangesForDriver(uid, champData, analysis) {
    if (!analysis.stage || analysis.validRangesComputed[uid]) return;

    const eventRange = computeValidStageRankRange(champData, analysis.stage, uid);
    const individualStage = getNextIndividualRaceStage(analysis.stage);
    const individualRange = analysis.stage.mode === 'full'
      ? computeValidStageRankRange(champData, individualStage, uid)
      : eventRange;

    if (eventRange) {
      analysis.forecasts[uid].bestRank = eventRange.bestRank;
      analysis.forecasts[uid].worstRank = eventRange.worstRank;
    }
    if (individualRange) analysis.individualRanges[uid] = individualRange;
    analysis.validRangesComputed[uid] = true;
  }

  function getNextIndividualRaceStage(eventStage) {
    if (eventStage.mode !== 'full') return eventStage;
    return {
      ...eventStage,
      mode: 'race1',
      maximumBonus: Number.isFinite(eventStage.race1MaximumBonus)
        ? eventStage.race1MaximumBonus
        : 2
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
    const driverCount = (
      champData.uidsByStandings || Object.keys(champData.driverNames || {})
    ).length;
    const position = useMaximum ? 1 : driverCount;
    let addedBonus = state.addedBonus;
    let wins = state.wins;
    let podiums = state.podiums;

    remainingStages.forEach(stage => {
      const outcome = buildOutcomeTemplates(champData, stage)
        .find(template => template.positions.every(value => value === position));
      if (!outcome) return;

      const currentEventPoints = Number(eventPoints[stage.eventIndex]) || 0;
      eventPoints[stage.eventIndex] = stage.mode === 'race2'
        ? currentEventPoints + outcome.eventPoints
        : outcome.eventPoints;
      wins += outcome.winsAdded;
      podiums += outcome.podiumsAdded;
      if (useMaximum) addedBonus += getStageMaximumBonus(stage);
    });

    const countedFinishingPoints = eventPoints
      .slice().sort((a, b) => b - a).slice(0, champData.keepEvents)
      .reduce((sum, value) => sum + (Number(value) || 0), 0);

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
    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const remainingStages = getAllRemainingStages(champData);
    const currentState = targetUid => ({
      uid: targetUid,
      eventPointsByEvent: (champData.racePointsPerEvent[targetUid] || []).slice(),
      addedBonus: 0,
      wins: Number(champData.winsPerDriver[targetUid]) || 0,
      podiums: Number(champData.podiumsPerDriver[targetUid]) || 0
    });

    const bestField = uids.map(otherUid => projectRemainingExtreme(
      currentState(otherUid), otherUid, champData, remainingStages, otherUid === uid
    ));
    const worstField = uids.map(otherUid => projectRemainingExtreme(
      currentState(otherUid), otherUid, champData, remainingStages, otherUid !== uid
    ));

    return rankForStateList(bestField, uid, champData) === currentRank
      && rankForStateList(worstField, uid, champData) === currentRank;
  }

  function computeSingleRaceClinchingScenarios(champData, analysis) {
    if (!analysis.stage) return [];

    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const raceStage = getNextIndividualRaceStage(analysis.stage);
    const outcomes = buildOutcomeTemplates(champData, raceStage);
    const maximumBonus = getStageMaximumBonus(raceStage);
    const remainingStages = getStagesAfterNextRace(champData, raceStage);
    const scenarios = [];

    uids.forEach((uid, currentIndex) => {
      const currentRank = currentIndex + 1;
      if (isCurrentPositionLocked(uid, currentRank, champData)) return;

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

          const rivalBestOutcome = outcomes.find(outcome =>
            outcome.positions[0] !== targetPosition
          );
          const rivalWorstOutcome = outcomes.slice().reverse().find(outcome =>
            outcome.positions[0] !== targetPosition
          );
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

        const bestRank = rankForStateList(bestField, uid, champData);
        const worstRank = rankForStateList(worstField, uid, champData);
        if (bestRank === currentRank && worstRank === currentRank) {
          lockingPositions.push(targetPosition);
        }
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

  function outcomesAreCompatible(first, second) {
    return first.positions.every((position, index) =>
      position !== second.positions[index]
    );
  }

  function getStagesAfterEvent(champData, eventStage) {
    return getAllRemainingStages(champData)
      .filter(stage => stage.eventIndex > eventStage.eventIndex);
  }

  function buildEventOptions(uid, champData, eventStage, remainingStages, useMaximumFuture) {
    const outcomes = buildOutcomeTemplates(champData, eventStage);
    const maximumBonus = getStageMaximumBonus(eventStage);
    const options = [];

    outcomes.forEach(outcome => {
      for (let bonus = 0; bonus <= maximumBonus; bonus += 1) {
        options.push({
          outcome,
          eventScore: outcome.eventPoints + bonus,
          state: projectRemainingExtreme(
            projectDriverState(uid, outcome, bonus, champData, eventStage),
            uid, champData, remainingStages, useMaximumFuture
          )
        });
      }
    });

    return options;
  }

  function getStrongestCompatibleOption(options, occupiedOutcomes, champData) {
    return options
      .filter(option => occupiedOutcomes.every(occupied =>
        outcomesAreCompatible(option.outcome, occupied)
      ))
      .sort((a, b) => compareProjectedStates(a.state, b.state, champData))[0] || null;
  }

  function computeWholeEventClinch(champData, analysis, singleRaceScenarios) {
    if (!analysis.stage) return null;

    const uids = champData.uidsByStandings || Object.keys(champData.driverNames || {});
    const leaderUid = uids[0];
    if (!leaderUid || uids.length < 2) return null;
    if (singleRaceScenarios.some(scenario => scenario.uid === leaderUid)) return null;
    if (isCurrentPositionLocked(leaderUid, 1, champData)) return null;

    const eventStage = analysis.stage;
    const remainingStages = getStagesAfterEvent(champData, eventStage);
    const targetOptions = buildEventOptions(
      leaderUid, champData, eventStage, remainingStages, false
    );
    const rivalOptionsByUid = {};
    uids.slice(1).forEach(uid => {
      rivalOptionsByUid[uid] = buildEventOptions(
        uid, champData, eventStage, remainingStages, true
      );
    });

    for (const rivalUid of uids.slice(1)) {
      const rivalOptions = rivalOptionsByUid[rivalUid];
      const compatibilityCache = new Map();
      let greatestFailingDifference = -Infinity;
      const successfulDifferences = [];

      targetOptions.forEach(targetOption => {
        rivalOptions.forEach(rivalOption => {
          if (!outcomesAreCompatible(targetOption.outcome, rivalOption.outcome)) return;

          const field = [targetOption.state, rivalOption.state];
          let completeField = true;

          uids.forEach(otherUid => {
            if (!completeField || otherUid === leaderUid || otherUid === rivalUid) return;

            const key = `${otherUid}|${targetOption.outcome.positions.join(',')}|${rivalOption.outcome.positions.join(',')}`;
            if (!compatibilityCache.has(key)) {
              compatibilityCache.set(key, getStrongestCompatibleOption(
                rivalOptionsByUid[otherUid],
                [targetOption.outcome, rivalOption.outcome],
                champData
              ));
            }

            const option = compatibilityCache.get(key);
            if (!option) {
              completeField = false;
              return;
            }
            field.push(option.state);
          });

          if (!completeField) return;
          const difference = targetOption.eventScore - rivalOption.eventScore;
          if (rankForStateList(field, leaderUid, champData) === 1) {
            successfulDifferences.push(difference);
          } else {
            greatestFailingDifference = Math.max(greatestFailingDifference, difference);
          }
        });
      });

      if (!successfulDifferences.length) continue;
      const requiredDifference = Number.isFinite(greatestFailingDifference)
        ? greatestFailingDifference + 1
        : Math.min(...successfulDifferences);
      if (!successfulDifferences.some(difference => difference >= requiredDifference)) continue;

      return {
        type: 'event',
        uid: leaderUid,
        rank: 1,
        rivalUid,
        requiredDifference
      };
    }

    return null;
  }

  function formatEventPointsCondition(requiredDifference, rivalName) {
    if (requiredDifference > 0) {
      return `scores at least ${requiredDifference} more points than ${rivalName}`;
    }
    if (requiredDifference === 0) {
      return `matches or outscores ${rivalName}`;
    }
    return `finishes no more than ${Math.abs(requiredDifference)} points behind ${rivalName}`;
  }

  function renderClinchingScenarios(champData, analysis) {
    const scenarios = computeSingleRaceClinchingScenarios(champData, analysis);
    const wholeEventClinch = computeWholeEventClinch(champData, analysis, scenarios);
    if (wholeEventClinch) scenarios.push(wholeEventClinch);
    if (!scenarios.length) return '';

    const raceLabel = getNextIndividualRaceLabel(analysis.stage);
    const items = scenarios.map(scenario => {
      const name = champData.driverNames[scenario.uid] || scenario.uid;
      if (scenario.type === 'race') {
        return `<li>If <strong>${escapeHtml(name)}</strong> finishes ${escapeHtml(scenario.finishCondition)} in ${escapeHtml(raceLabel)}, P${scenario.rank} is locked in.</li>`;
      }

      const rivalName = champData.driverNames[scenario.rivalUid] || scenario.rivalUid;
      const condition = formatEventPointsCondition(
        scenario.requiredDifference, rivalName
      );
      return `<li>If <strong>${escapeHtml(name)}</strong> ${escapeHtml(condition)} across the next event, P${scenario.rank} is locked in.</li>`;
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

        if (selectedPosition === opponentPosition) {
          return '<td class="matrix-impossible" aria-label="Same finishing position is impossible">—</td>';
        }

        const selectedNoBonus = projectDriverState(
          selectedUid, selectedOutcome, 0, champData, raceStage
        );
        const selectedWithBonus = projectDriverState(
          selectedUid, selectedOutcome, maximumBonus, champData, raceStage
        );
        const opponentNoBonus = projectDriverState(
          opponentUid, opponentOutcome, 0, champData, raceStage
        );
        const opponentWithBonus = projectDriverState(
          opponentUid, opponentOutcome, maximumBonus, champData, raceStage
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

        const label = `${selectedName} P${selectedPosition}, ${opponentName} P${opponentPosition}: ${formatPointsGap(gap)} points, ${outcomeText}`;
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

  // ---------- Modal UI ----------
  function renderNextRacePanel(uid, champData, analysis) {
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

    ensureValidRangesForDriver(uid, champData, analysis);
    const forecast = analysis.forecasts[uid];
    const stage = analysis.stage;
    const name = champData.driverNames[uid] || uid;
    const aboveName = forecast.aboveUid ? champData.driverNames[forecast.aboveUid] || forecast.aboveUid : '';
    const belowName = forecast.belowUid ? champData.driverNames[forecast.belowUid] || forecast.belowUid : '';
    const currentTotal = Number(champData.finalTotals[uid]) || 0;
    const individualRange = analysis.individualRanges?.[uid] || {
      bestRank: forecast.bestRank,
      worstRank: forecast.worstRank
    };
    const individualRangeText = formatRankRange(
      individualRange.bestRank, individualRange.worstRank
    );
    const eventRangeText = formatRankRange(forecast.bestRank, forecast.worstRank);
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

      <div class="scenario-moves">
        <div class="scenario-move">
          <strong>${escapeHtml(upwardTitle)}</strong>
          <span>${escapeHtml(upwardText)}</span>
        </div>
        <div class="scenario-move">
          <strong>${escapeHtml(downwardTitle)}</strong>
          <span>${escapeHtml(downwardText)}</span>
        </div>
      </div>

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

  function renderTable(champData, extremes, nextRaceAnalysis) {
    const { driverNames, uidsByStandings } = champData;
    const uids = uidsByStandings || Object.keys(driverNames || {});
    const { minTotals, maxTotals, minFinish, maxFinish } = extremes;
    const clinchingScenarios = renderClinchingScenarios(champData, nextRaceAnalysis);

    let html = `
      <h3 style="margin:0 0 10px 0;">Title Scenarios</h3>
      <p style="margin:0 0 8px 0;">
        Events: <strong>${champData.eventsRemaining} remaining</strong> &nbsp;•&nbsp;
        Drops: <strong>${champData.safeDropRaces}</strong> &nbsp;•&nbsp;
        Best <strong>${champData.keepEvents}</strong> count
      </p>
      <p style="font-size:11px;color:#666;margin:0 0 8px;">Select a driver for next-event scenarios.</p>
      <div style="overflow-x:auto;">
        <table class="calc-table" style="border-collapse:collapse; width:100%;">
          <thead>
            <tr>
              <th class="pos-col" style="padding:6px;border:1px solid #333;">Pos</th>
              <th class="driver-name-col" style="padding:6px;border:1px solid #333;text-align:left;">Driver</th>
              <th style="padding:6px;border:1px solid #333;">Current</th>
              <th style="padding:6px;border:1px solid #333;">Min</th>
              <th style="padding:6px;border:1px solid #333;">Max</th>
              <th class="pos-col" style="padding:6px;border:1px solid #333;">Best</th>
              <th class="pos-col" style="padding:6px;border:1px solid #333;">Worst</th>
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

  // ---------- Public API ----------
  window.openPointsCalculator = function (champData) {
    if (!champData) {
      alert('No championship data available yet.');
      return;
    }

    const extremes = computeExtremes(champData);
    const nextRaceAnalysis = computeNextStageAnalysis(champData);
    activeComparisonState = null;
    console.log('[Calculator] Data:', champData);
    console.log('[Calculator] Extremes:', extremes);
    console.log('[Calculator] Next race:', nextRaceAnalysis);

    renderTable(champData, extremes, nextRaceAnalysis);
    qs('calcModal').style.display = 'flex';
  };

  window.closePointsCalculator = function () {
    const modal = qs('calcModal');
    if (modal) modal.style.display = 'none';
  };

  document.addEventListener('click', event => {
    const modal = qs('calcModal');
    if (!modal || modal.style.display !== 'flex') return;
    if (event.target === modal) window.closePointsCalculator();
  });
})();
