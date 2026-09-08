const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../championship_calculator.js'), 'utf8');
function data(n, lead = 15) {
  const uids = Array.from({length:n}, (_, i) => 'd'+i);
  const map = fn => Object.fromEntries(uids.map((uid,i) => [uid,fn(i)]));
  return { uidsByStandings:uids, driverNames:map(i=>'Driver '+i),
    positionToPoints:{1:20,2:16,3:13,4:10,5:8,6:6,7:5,8:3,9:2,10:1},
    eventCount:2, keepEvents:2, racePointsPerEvent:map(i=>[i===0?lead:0,0]),
    bonusPointsPerDriver:map(()=>0), winsPerDriver:map(()=>0), podiumsPerDriver:map(()=>0),
    finalTotals:map(i=>i===0?lead:0), eventDetails:[], specialEventIndexes:[] };
}
function calculate(n, mode, lead = 15) {
  let message;
  const self = {postMessage: value => { message = JSON.parse(JSON.stringify(value)); }};
  vm.runInNewContext(source, {self});
  self.onmessage({ data:{type:'ranges',uid:'d0',champData:data(n,lead),
    stage:{eventIndex:1,mode,maximumBonus:0,race1MaximumBonus:0}} });
  assert.equal(message.error, undefined);
  return message.result;
}
test('seven-driver regression uses unique positions: worst P2, not P7', () => {
  assert.deepEqual(calculate(7,'race1').individualRange, {bestRank:1,worstRank:2});
});
test('two-race grids above six retain an exact single-race range only', () => {
  const result = calculate(7,'full');
  assert.equal(result.eventRange,null);
  assert.deepEqual(result.individualRange,{bestRank:1,worstRank:2});
});
test('single-race limit includes ten and excludes eleven', () => {
  assert.ok(calculate(10,'race1',0).individualRange);
  assert.deepEqual(calculate(11,'race1'),{eventRange:null,individualRange:null});
});
test('six-driver two-race full search remains available', () => {
  const result = calculate(6,'full',100);
  assert.deepEqual(result.eventRange,{bestRank:1,worstRank:1});
  assert.deepEqual(result.individualRange,{bestRank:1,worstRank:1});
});
test('Race 2 and special events use the single-race limit', () => {
  assert.ok(calculate(7,'race2').eventRange);
  assert.ok(calculate(7,'special').eventRange);
});
function page() {
  const elements = {};
  for (const id of ['calcModal','calcModalBody','nextRaceScenarioPanel']) elements[id] = {
    style:{}, attrs:{}, innerHTML:'', setAttribute(k,v){this.attrs[k]=v;},
    removeAttribute(k){delete this.attrs[k];}, querySelector(){return {addEventListener(){}};}
  };
  const workers = [];
  class Worker {
    constructor() {workers.push(this);}
    postMessage(payload) {this.payload=payload;}
    terminate() {this.terminated=true;}
  }
  const context = { window:{}, Worker, document:{getElementById:id=>elements[id],addEventListener(){},querySelectorAll(){return [];}} };
  vm.runInNewContext(source.replace('  // ---------- Public API ----------', '  window.testApi = {renderNextRacePanel, computeNextStageAnalysis};\n  // ---------- Public API ----------'),context);
  return {window:context.window,elements,workers};
}
test('overview displays loading immediately and closing cancels background work', async () => {
  const state=page();
  const pending=state.window.openPointsCalculator(data(7));
  assert.match(state.elements.calcModalBody.innerHTML,/Calculating/);
  assert.equal(state.elements.calcModal.style.display,'flex');
  state.window.closePointsCalculator();
  await pending;
  assert.equal(state.workers[0].terminated,true);
  assert.equal(state.elements.calcModal.style.display,'none');
});
test('worker failure clears loading and offers retry', async () => {
  const state=page();
  const pending=state.window.openPointsCalculator(data(7));
  state.workers[0].onerror();
  await pending;
  assert.match(state.elements.calcModalBody.innerHTML,/Try again/);
  assert.equal(state.elements.calcModalBody.attrs['aria-busy'],undefined);
});
test('reopening cancels old work and ignores its stale reply', async () => {
  const state=page();
  const first=state.window.openPointsCalculator(data(7));
  const second=state.window.openPointsCalculator(data(8));
  assert.equal(state.workers[0].terminated,true);
  state.workers[0].onmessage({data:{result:{}}});
  await first;
  assert.match(state.elements.calcModalBody.innerHTML,/Calculating/);
  state.window.closePointsCalculator();
  await second;
});

test('actual background worker returns a serializable overview and exact ranges', async () => {
  const { Worker } = require('node:worker_threads');
  const worker = new Worker(`
    const {parentPort} = require('node:worker_threads');
    global.self = {postMessage: value => parentPort.postMessage(value)};
    ${source}
    parentPort.on('message', data => self.onmessage({data}));
  `, {eval:true});
  const request = payload => new Promise((resolve,reject) => {
    const receive = message => {
      if (typeof message.progress === 'number') return;
      worker.off('message',receive);
      resolve(message);
    };
    worker.on('message',receive);
    worker.once('error',reject);
    worker.postMessage(payload);
  });
  try {
    const champData=data(7);
    champData.eventDetails=[{index:1,trackName:'Monza',hasRace1Results:false,hasRace2Results:false}];
    const overview=await request({type:'overview',champData});
    assert.equal(overview.error,undefined);
    assert.equal(overview.result.analysis.stage.mode,'full');
    const ranges=await request({type:'ranges',champData,uid:'d0',stage:{eventIndex:1,mode:'race1',maximumBonus:0}});
    assert.deepEqual(ranges.result.individualRange,{bestRank:1,worstRank:2});
  } finally { await worker.terminate(); }
});


test('larger-grid panels show unavailable event ranges without an approximate fallback', async () => {
  const state=page(), champData=data(7);
  champData.eventDetails=[{index:1,trackName:'Monza',hasRace1Results:false}];
  const analysis=state.window.testApi.computeNextStageAnalysis(champData);
  const pending=state.window.testApi.renderNextRacePanel('d0',champData,analysis);
  const panel=state.elements.nextRaceScenarioPanel;
  assert.match(panel.innerHTML,/Calculating race positions/);
  state.workers[0].onmessage({data:{result:{eventRange:null,individualRange:{bestRank:1,worstRank:2}}}});
  await pending;
  assert.match(panel.innerHTML,/Unavailable/);
  assert.match(panel.innerHTML,/P1–P2/);
  assert.doesNotMatch(panel.innerHTML,/scenario-moves/);
  await state.window.testApi.renderNextRacePanel('d0',champData,analysis);
  assert.equal(state.workers.length,1, 'completed ranges are cached');
});

test('selecting another driver cancels the previous range calculation', async () => {
  const state=page(), champData=data(7);
  champData.eventDetails=[{index:1,trackName:'Monza',hasRace1Results:false}];
  const analysis=state.window.testApi.computeNextStageAnalysis(champData);
  const first=state.window.testApi.renderNextRacePanel('d0',champData,analysis);
  const second=state.window.testApi.renderNextRacePanel('d1',champData,analysis);
  assert.equal(state.workers[0].terminated,true);
  state.workers[1].onmessage({data:{result:{eventRange:null,individualRange:{bestRank:1,worstRank:3}}}});
  await Promise.all([first,second]);
  assert.match(state.elements.nextRaceScenarioPanel.innerHTML,/<h4>Driver 1/);
  assert.equal(state.elements.nextRaceScenarioPanel.attrs['aria-busy'],undefined);
});


test('overview progress reports completed work monotonically and finishes at 100', () => {
  const messages=[];
  const self={postMessage: value => messages.push(value)};
  vm.runInNewContext(source,{self});
  const champData=data(4);
  champData.eventCount=4;
  champData.keepEvents=4;
  champData.eventDetails=[1,2,3].map(index=>({index,trackName:'Monza',hasRace1Results:false}));
  self.onmessage({data:{type:'overview',champData}});
  const percentages=messages.filter(m=>typeof m.progress==='number').map(m=>m.progress);
  assert.equal(percentages[0],0);
  assert.equal(percentages.at(-1),100);
  assert.ok(percentages.some(p=>p>0&&p<100));
  assert.ok(percentages.every((p,i)=>p>=0&&p<=100&&(!i||p>=percentages[i-1])));
  assert.ok(messages.at(-1).result);
});

test('progress updates do not terminate the worker or replace the loading display', async () => {
  const state=page();
  const nodes={};
  state.elements.calcModalBody.querySelector=selector=>nodes[selector] ||= {};
  const pending=state.window.openPointsCalculator(data(7));
  state.workers[0].onmessage({data:{progress:42}});
  assert.equal(state.workers[0].terminated,undefined);
  assert.equal(nodes['[data-calculation-progress]'].value,42);
  assert.equal(nodes['[data-calculation-percent]'].textContent,'42%');
  assert.match(state.elements.calcModalBody.innerHTML,/Calculating title scenarios/);
  state.window.closePointsCalculator();
  await pending;
});

test('selected-driver progress updates the bar and ranges finish at 100 percent', async () => {
  const state=page(), champData=data(7);
  champData.eventDetails=[{index:1,trackName:'Monza',hasRace1Results:false}];
  const nodes={};
  const panel=state.elements.nextRaceScenarioPanel;
  panel.querySelector=selector=>nodes[selector] ||= {};
  const analysis=state.window.testApi.computeNextStageAnalysis(champData);
  const pending=state.window.testApi.renderNextRacePanel('d0',champData,analysis);
  state.workers[0].onmessage({data:{progress:65}});
  assert.equal(nodes['[data-calculation-progress]'].value,65);
  assert.equal(nodes['[data-calculation-percent]'].textContent,'65%');
  state.workers[0].onmessage({data:{result:{eventRange:null,individualRange:{bestRank:1,worstRank:2}}}});
  await pending;
  assert.doesNotMatch(panel.innerHTML,/Exact two-race ranges/);
  const messages=[];
  const self={postMessage: m=>messages.push(m)};
  vm.runInNewContext(source,{self});
  self.onmessage({data:{type:'ranges',champData,uid:'d0',stage:{eventIndex:1,mode:'race1',maximumBonus:0}}});
  const progress=messages.filter(m=>'progress' in m).map(m=>m.progress);
  assert.equal(progress[0],0);assert.equal(progress.at(-1),100);
  assert.ok(progress.some(p=>p>0&&p<100));
  assert.ok(progress.every((p,i)=>!i||p>=progress[i-1]));
});
