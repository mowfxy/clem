import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasCapacity,isBelowSwitchThreshold,resetWindows} from '../../core/account-usage.ts';

const usage=(hourly:number,weekly:number)=>({rateLimits:{primary:{usedPercent:100-hourly,windowDurationMins:300,resetsAt:1900000000},secondary:{usedPercent:100-weekly,windowDurationMins:10080,resetsAt:1900000000}}});

test('switching requires a known window below its threshold and a fully usable destination',()=>{
  assert.equal(isBelowSwitchThreshold(usage(10,5)),false);
  assert.equal(isBelowSwitchThreshold(usage(9.9,5)),true);
  assert.equal(isBelowSwitchThreshold(usage(10,4.9)),true);
  assert.equal(hasCapacity(usage(10,5)),true);
  assert.equal(hasCapacity(usage(100,4)),false);
  assert.equal(hasCapacity(undefined),false);
});

test('a confirmed usage increase emits a reset once and unknown usage emits none',()=>{
  const before=usage(2,40),after=usage(95,40);
  before.rateLimits.primary.resetsAt=1700000000;
  assert.deepEqual(resetWindows(before,after),['codex hourly']);
  assert.deepEqual(resetWindows(usage(95,40),usage(95,40)),[]);
  assert.deepEqual(resetWindows(undefined,usage(95,40)),[]);
  assert.deepEqual(resetWindows({ordinaryUsageAllowed:false},{ordinaryUsageAllowed:true}),['codex hourly']);
});
