import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextAutomation,firstAutomationRun} from '../src/automation-schedule.ts';
const at=(y:number,mo:number,d:number,h:number,mi=0)=>new Date(y,mo,d,h,mi).getTime();
test('a daily routine that ran late keeps its own time of day',()=>{
  // Scheduled for 08:00, the PC woke at 10:37: the next run is tomorrow at 08:00, not 10:37.
  assert.equal(nextAutomation('daily',at(2026,2,10,8),at(2026,2,10,10,37)),at(2026,2,11,8));
});
test('missed days are skipped, never replayed',()=>{
  assert.equal(nextAutomation('daily',at(2026,2,10,8),at(2026,2,14,9)),at(2026,2,15,8));
  assert.equal(nextAutomation('daily',at(2026,2,10,8),at(2026,2,14,7)),at(2026,2,14,8));
});
test('a weekly routine stays on its weekday and time',()=>{
  const monday=at(2026,2,9,8); // Monday 9 March 2026
  assert.equal(new Date(monday).getDay(),1);
  assert.equal(nextAutomation('weekly',monday,at(2026,2,11,12)),at(2026,2,16,8));
  assert.equal(nextAutomation('weekly',monday,at(2026,2,25,12)),at(2026,2,30,8));
});
test('the next run is always strictly after now',()=>{
  assert.equal(nextAutomation('daily',at(2026,2,10,8),at(2026,2,11,8)),at(2026,2,12,8));
  assert.equal(firstAutomationRun({time:'08:00'},at(2026,2,10,8)),at(2026,2,11,8));
  assert.equal(firstAutomationRun({time:'08:00',day:'monday'},at(2026,2,10,9)),at(2026,2,16,8));
});
