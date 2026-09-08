const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../championship_calculator.js'),'utf8');
const context={window:{},document:{addEventListener(){}}};
vm.runInNewContext(source.replace('  // ---------- Public API ----------',
  '  window.audit={computeExtremes,computeNextStageAnalysis,computeSingleRaceClinchingScenarios};\n  // ---------- Public API ----------'),context);
const api=context.window.audit;
function fixture(n=3) {
  const ids=Array.from({length:n},(_,i)=>'d'+i),map=fn=>Object.fromEntries(ids.map((uid,i)=>[uid,fn(i)]));
  return {uidsByStandings:ids,driverNames:map(i=>'D'+i),eventCount:2,keepEvents:2,
    positionToPoints:{1:20,2:16,3:13},racePointsPerEvent:map(i=>[20-i*2,0]),
    bonusPointsPerDriver:map(()=>0),winsPerDriver:map(()=>0),podiumsPerDriver:map(()=>0),
    finalTotals:map(i=>20-i*2),eventDetails:[{index:1,hasRace1Results:true,hasRace2Results:false,hasFastestLapR2Result:true,hasOffPodiumR2Result:true}]};
}
test('remaining Race 2 adds points to Race 1, instead of disappearing',()=>{
  const d=fixture();d.racePointsPerEvent.d0=[20,16];d.eventDetails[0].hasFastestLapR2Result=false;
  const b=api.computeExtremes(d);
  assert.equal(b.minTotals.d0,49);assert.equal(b.maxTotals.d0,57);
});
test('drops are recalculated and previously earned bonuses are never dropped',()=>{
  const d=fixture();d.keepEvents=1;d.racePointsPerEvent.d0=[35,16];d.bonusPointsPerDriver.d0=5;
  d.eventDetails[0].hasFastestLapR2Result=false;
  const b=api.computeExtremes(d);
  assert.equal(b.minTotals.d0,40);assert.equal(b.maxTotals.d0,42);
});
test('full and special events use last-place minimum points',()=>{
  const d=fixture();d.eventDetails=[{index:1,hasRace1Results:false,hasOffPodiumR1Result:true,hasOffPodiumR2Result:true}];
  assert.equal(api.computeExtremes(d).minTotals.d0,46);
  assert.equal(api.computeExtremes(d).maxTotals.d0,63);
  d.eventDetails[0].special=true;
  assert.equal(api.computeExtremes(d).maxTotals.d0,62);
});
test('possible future wins prevent a false tie lock; sufficient existing wins can prove it',()=>{
  const d=fixture(2);d.racePointsPerEvent.d0=[4,0];d.racePointsPerEvent.d1=[0,0];
  assert.equal(api.computeExtremes(d).maxFinish.d0,2);
  d.winsPerDriver.d0=2;
  assert.equal(api.computeExtremes(d).maxFinish.d0,1);
});
test('a completed season uses the established final standings order',()=>{
  const d=fixture();d.eventDetails[0].hasRace2Results=true;
  const b=api.computeExtremes(d);
  d.uidsByStandings.forEach((uid,i)=>{assert.equal(b.minFinish[uid],i+1);assert.equal(b.maxFinish[uid],i+1);});
});
function orders(n) {
  const result=[];
  function visit(prefix,remaining) {
    if(!remaining.length){
      for(let finishers=0;finishers<=n;finishers++) result.push(prefix.map(p=>p<=finishers?p:finishers+1));
      return;
    }
    remaining.forEach((p,i)=>visit([...prefix,p],remaining.filter((_,j)=>j!==i)));
  }
  visit([],Array.from({length:n},(_,i)=>i+1));return [...new Map(result.map(order=>[order.join(),order])).values()];
}
test('conservative bounds contain all 100 valid two-race classifications, including shared-last scores and drops',()=>{
  const d=fixture();d.eventCount=3;d.keepEvents=2;
  d.eventDetails=[1,2].map(index=>({index,special:true,hasRace1Results:false,hasPoleResult:true,hasFastestLapR1Result:true}));
  const bounds=api.computeExtremes(d), all=orders(3);
  for(const first of all) for(const second of all){
    const states=d.uidsByStandings.map((uid,i)=>{
      const points=[d.racePointsPerEvent[uid][0],(d.positionToPoints[first[i]]||0)*2,(d.positionToPoints[second[i]]||0)*2];
      return {uid,total:points.sort((a,b)=>b-a).slice(0,2).reduce((a,b)=>a+b,0),wins:Number(first[i]===1)+Number(second[i]===1),podiums:Number(first[i]>0)+Number(second[i]>0)};
    }).sort((a,b)=>b.total-a.total||b.wins-a.wins||b.podiums-a.podiums||a.uid.localeCompare(b.uid));
    states.forEach((state,i)=>{
      assert.ok(state.total>=bounds.minTotals[state.uid]&&state.total<=bounds.maxTotals[state.uid]);
      assert.ok(i+1>=bounds.minFinish[state.uid]&&i+1<=bounds.maxFinish[state.uid]);
    });
  }
});
test('a next-race finish condition proves a title that is not already locked',()=>{
  const d=fixture(2);d.racePointsPerEvent.d0=[3,0];d.racePointsPerEvent.d1=[0,0];d.finalTotals.d0=3;d.finalTotals.d1=0;
  const bounds=api.computeExtremes(d);assert.equal(bounds.maxFinish.d0,2);
  const scenarios=api.computeSingleRaceClinchingScenarios(d,api.computeNextStageAnalysis(d));
  const leader=scenarios.find(s=>s.uid==='d0');
  assert.equal(leader.finishCondition,'P1');
  for(const order of orders(2)){
    if(order[0]!==1)continue;
    assert.ok(3+(d.positionToPoints[order[0]]||0)>(d.positionToPoints[order[1]]||0));
  }
});
