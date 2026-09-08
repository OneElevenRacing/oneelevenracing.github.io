const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../poll.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
function setup(admin=true,confirmed=true){
  const writes=[],prompts=[],status={textContent:''};
  let driver={active:true,isAdmin:admin};
  const context={window:{pollIsAdmin:admin},console,Intl,Date,
    confirm:message=>{prompts.push(message);return confirmed;},
    document:{getElementById:id=>id==='pollRaceDateStatus'?status:{addEventListener(){}},querySelectorAll:()=>[]},
    firebase:{auth:()=>({currentUser:{uid:'d1'}}),database:()=>({ref:()=>({
      once:async()=>({val:()=>driver}), update:async patch=>writes.push(patch)
    })})}
  };
  vm.runInNewContext(source,context);
  context.getUkTodayKey=()=>'2026-12-30';
  return {context,writes,prompts,status,revoke:()=>{driver={active:true,isAdmin:false};}};
}
test('confirming an admin date sets the date and 7pm in one update',async()=>{
  const s=setup();await s.context.schedulePollRace('2026-12-31');
  assert.equal(s.prompts.length,1);
  assert.equal(s.status.textContent,'');
  assert.deepEqual(JSON.parse(JSON.stringify(s.writes)),[{race_date:'Thu, 31st Dec 2026',race_time:'7.00pm'}]);
});
test('cancel, non-admin and past-date actions never write',async()=>{
  for(const s of [setup(true,false),setup(false)]){await s.context.schedulePollRace('2026-12-31');assert.equal(s.writes.length,0);}
  const s=setup();await s.context.schedulePollRace('2026-12-29');assert.equal(s.prompts.length,0);assert.equal(s.writes.length,0);
});
test('admin permission is rechecked immediately before saving',async()=>{
  const s=setup();s.revoke();await s.context.schedulePollRace('2026-12-31');
  assert.equal(s.writes.length,0);assert.match(s.status.textContent,/Admin access is required/);
});
test('date matching preserves an explicit year and supports legacy dates at New Year',()=>{
  const {context:c}=setup();
  assert.equal(c.scheduledDateKey('Fri, 1st Jan'),'2027-01-01');
  assert.equal(c.scheduledDateKey('Thu, 1st Jan 2026'),'2026-01-01');
  assert.equal(c.scheduledDateKey('TBD'),'');
  assert.equal(c.getOptionDateKey({weekStart:'2026-12-28'},'Fri 1/1',4),'2027-01-01');
});
test('highlight outlines only the matching column and moves without rebuilding answers',()=>{
  const {context:c}=setup();
  const cell=()=>({classes:{},classList:{toggle(name,value){this.owner.classes[name]=value;}},setAttribute(){},removeAttribute(){}});
  const rows=Array.from({length:3},()=>({cells:Array.from({length:3},()=>{const v=cell();v.classList.owner=v;return v;})}));
  c.document.querySelectorAll=selector=>{assert.equal(selector,'#responsesTable');return [{rows}];};
  vm.runInNewContext("availablePolls=[{data:{weekStart:'2026-12-30',options:['Wed 30/12','Thu 31/12']}}];scheduledRaceDate='Thu, 31st Dec 2026';refreshRaceDateColumns();",c);
  assert.ok(rows.every(row=>row.cells[2].classes['scheduled-race-column']));
  assert.equal(rows[0].cells[2].classes['scheduled-race-top'],true);
  assert.equal(rows[2].cells[2].classes['scheduled-race-bottom'],true);
  vm.runInNewContext("scheduledRaceDate='Wed, 30th Dec 2026';refreshRaceDateColumns();",c);
  assert.ok(rows.every(row=>row.cells[1].classes['scheduled-race-column']&&!row.cells[2].classes['scheduled-race-column']));
});
