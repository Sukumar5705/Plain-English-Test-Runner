import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict } from '../src/agent.js';

test('PASS requires a completed run and at least one passed assertion', () => {
  assert.deepEqual(computeVerdict({ passedAssertions: 1, failedAssertions: 0, finishStatus: 'done', fatalProblem: null }), {
    verdict: 'PASS', reason: 'All executed assertions passed and the agent completed the requested test.'
  });
});

test('a failed assertion takes precedence and produces FAIL', () => {
  assert.equal(computeVerdict({ passedAssertions: 1, failedAssertions: 1, finishStatus: 'blocked', fatalProblem: 'timeout' }).verdict, 'FAIL');
});

test('a browser or agent problem produces ERROR, not FAIL', () => {
  assert.equal(computeVerdict({ passedAssertions: 0, failedAssertions: 0, finishStatus: null, fatalProblem: 'step limit reached' }).verdict, 'ERROR');
});

test('finishing without assertions is inconclusive', () => {
  assert.equal(computeVerdict({ passedAssertions: 0, failedAssertions: 0, finishStatus: 'done', fatalProblem: null }).verdict, 'ERROR');
});
