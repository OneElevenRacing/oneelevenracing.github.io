const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={window:{},document:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../championship_calculator.js'),'utf8').replace(
  '  // ---------- Public API ----------',
  '  window.audit={computeValidStageRankRange,computeExtremes,getEventMaximumBonus,renderPromotionExample};\n  // ---------- Public API ----------'),context);
const api=context.window.audit;
function fixture(n){
  const ids=Array.from({length:n},(_,i)=>'d'+i),map=fn=>Object.fromEntries(ids.map((uid,i)=>[uid,fn(i)]));
  return {uidsByStandings:ids,driverNames:map(i=>'Driver '+i),eventCount:2,keepEvents:2,
    positionToPoints:{1:20,2:16,3:13,4:10,5:8,6:6,7:5,8:3,9:2,10:1},
    racePointsPerEvent:map(i=>[30-i,0]),bonusPointsPerDriver:map(()=>0),
    winsPerDriver:map(()=>0),podiumsPerDriver:map(()=>0),finalTotals:map(i=>30-i),
    eventDetails:[{index:1,hasRace1Results:false}]};
}
test('six-driver minimum adds six points per race, unless those scores are dropped',()=>{
  const d=fixture(6);
  assert.equal(api.computeExtremes(d).minTotals.d0,42);
  d.eventDetails[0].hasRace1Results=true;
  assert.equal(api.computeExtremes(d).minTotals.d0,36);
  d.keepEvents=1;
  assert.equal(api.computeExtremes(d).minTotals.d0,30);
});
test('fastest lap and off-podium fastest lap are independently available awards',()=>{
  assert.equal(api.getEventMaximumBonus({},'full'),5);
  assert.equal(api.getEventMaximumBonus({},'race1'),3);
  assert.equal(api.getEventMaximumBonus({},'race2'),2);
  assert.equal(api.getEventMaximumBonus({},'special'),3);
  assert.equal(api.getEventMaximumBonus({hasFastestLapR1Result:true},'race1'),2);
  assert.equal(api.getEventMaximumBonus({hasFastestLapR1Result:true,hasOffPodiumR1Result:true},'race1'),1);
});
function classifications(n){
  const found=new Map();
  function visit(order,rest){
    if(!rest.length){
      for(let k=0;k<=n;k++){
        const values=order.map(p=>p<=k?p:k+1);found.set(values.join(),values);
      }
      return;
    }
    rest.forEach((p,i)=>visit([...order,p],rest.filter((_,j)=>j!==i)));
  }
  visit([],Array.from({length:n},(_,i)=>i+1));return [...found.values()];
}
function rankField(d,positions,bonuses){
  return d.uidsByStandings.map((uid,i)=>({uid,total:d.racePointsPerEvent[uid][0]+d.positionToPoints[positions[i]]+bonuses[i],
    wins:Number(positions[i]===1),podiums:Number(positions[i]<=3)}))
    .sort((a,b)=>b.total-a.total||b.wins-a.wins||b.podiums-a.podiums||a.uid.localeCompare(b.uid));
}
test('rank ranges and lowest promotion finish match exhaustive independent scoring with every bonus allocation',()=>{
  const d=fixture(4),uid='d2';
  let best=4,worst=1,lowest=0;
  for(const positions of classifications(4)){
    const off=positions.map((p,i)=>p>3?i:-1).filter(i=>i>=0);
    for(let pole=0;pole<4;pole++)for(let fl=0;fl<4;fl++)for(const op of (off.length?off:[-1])){
      const bonuses=Array(4).fill(0);bonuses[pole]++;bonuses[fl]++;if(op>=0)bonuses[op]++;
      const rank=rankField(d,positions,bonuses).findIndex(v=>v.uid===uid)+1;
      best=Math.min(best,rank);worst=Math.max(worst,rank);
      const noBonusRank=rankField(d,positions,Array(4).fill(0)).findIndex(v=>v.uid===uid)+1;
      if(noBonusRank<3)lowest=Math.max(lowest,positions[2]);
    }
  }
  const result=api.computeValidStageRankRange(d,{mode:'race1',eventIndex:1,maximumBonus:3},uid);
  assert.equal(result.bestRank,best);assert.equal(result.worstRank,worst);
  assert.equal(result.promotion.finish,lowest);
  const threat = result.promotion.rivalConditions.find(rival=>rival.uid==='d3');
  assert.equal(threat.kind,'threat');
  assert.equal(threat.dangerFinish,2); // P1 protects d2; rival d3 can win and pass d2 at P2.
  const rendered=api.renderPromotionExample(uid,d,{individualRanges:{[uid]:result}});
  assert.match(rendered,/Lowest finish to move up to P\d+: P\d+/);
  assert.match(rendered,/Drivers ahead you can pass if P\d+/);
  assert.match(rendered,/Safe from drivers behind you if you finish P1 or higher/);
  assert.doesNotMatch(rendered,/Drivers behind who could pass you/);
  assert.doesNotMatch(rendered,/in the championship after|<table/);

  const field=result.promotion.field;
  const positions=d.uidsByStandings.map(id=>field.find(v=>v.uid===id).finish);
  assert.ok(classifications(4).some(p=>p.join()===positions.join()));
  const bonuses=d.uidsByStandings.map(id=>field.find(v=>v.uid===id).awards.length);
  const awards=field.flatMap(v=>v.awards);
  assert.equal(awards.length,0);
  assert.equal(new Set(awards).size,awards.length);
  field.filter(v=>v.awards.some(a=>a.includes('off-podium'))).forEach(v=>assert.ok(v.finish>3));
  const ranked=rankField(d,positions,bonuses);
  assert.equal(ranked.findIndex(v=>v.uid===uid)+1,result.promotion.rank);
  ranked.forEach((v,i)=>assert.equal(field.find(entry=>entry.uid===v.uid).rank,i+1));
});
test('shared-last scenarios are included rather than forcing absent drivers into unique places',()=>{
  const d=fixture(4);
  const all=classifications(4);
  assert.ok(all.some(p=>p.join()==='1,2,3,3'));
  const result=api.computeValidStageRankRange(d,{mode:'race2',eventIndex:1,maximumBonus:0},'d3');
  assert.ok(result.promotion);
});


test('safety threshold protects against every trailing driver and never claims P0',()=>{
  const d=fixture(6),uid='d2';
  const promotion={finish:4,rank:2,rivalConditions:[
    {uid:'d3',kind:'threat',dangerFinish:4},
    {uid:'d4',kind:'threat',dangerFinish:2}
  ]};
  const render=()=>api.renderPromotionExample(uid,d,{individualRanges:{[uid]:{promotion}}});
  assert.match(render(),/Safe from drivers behind you if you finish P1 or higher/);
  promotion.rivalConditions[1].dangerFinish=1;
  assert.match(render(),/No finishing position guarantees/);
  assert.doesNotMatch(render(),/finish P0/);
  promotion.rivalConditions=[];
  assert.match(render(),/Safe from drivers behind you if you finish P6 or higher/);
});
