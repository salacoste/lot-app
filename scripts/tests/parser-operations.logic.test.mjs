import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceParserOperationsOwner, canonicalParserRunFilters, captureParserOperationsOwner,
  createParserOperationsOwner, ownsParserOperationsCallback, parseParserRunFilters,
  parserPollDelay, parserPollingPausedMessage, parserStatusLabel, readBoundedParserExport,
  validateParserAttemptPage, validateParserRunPage, validateParserTaskPage,
} from '../../utils/parserOperations.logic.shared.mjs';

const validRun = () => ({ id:'11111111-1111-4111-8111-111111111111',sourceFamily:'fedresurs',status:'failed',stopReason:'retry-budget-exhausted',totalTasks:1,pendingTasks:0,processingTasks:0,completedTasks:0,retryScheduledTasks:0,failedTasks:1,canceledTasks:0,createdAtUtc:'2026-07-17T10:00:00Z',updatedAtUtc:'2026-07-17T10:01:00Z',startedAtUtc:'2026-07-17T10:00:10Z',finishedAtUtc:'2026-07-17T10:01:00Z',cancelRequestedAtUtc:null,freshness:'terminal',resultFreshness:'unavailable',sourceControls:{policyVersion:'parser-run-source-controls/v1',environment:'development',adminOverride:false,maxConcurrency:1,requestDelayMs:5000,maxRetries:2,pageTimeoutSeconds:90,maxRows:100,captchaMode:'disabled',proxyMode:'disabled',proxyReference:null,proxyConfigured:false,diagnostics:['proxy-disabled','captcha-disabled','safe-defaults']},sourceStatusCounts:{'captcha-blocked':0,'rate-limited':0,'source-unavailable':1,timeout:0,'schema-changed':0},runAllowedActions:{cancel:false,resume:false,retryFailed:true,export:true},caveatCodes:['live-keyset-not-snapshot','redacted-operator-view']});

test('URL filter codec is closed and canonical', () => {
  assert.deepEqual(parseParserRunFilters('?status=failed&sourceFamily=fedresurs'), { ok: true, filters: { status: 'failed', sourceFamily: 'fedresurs' } });
  assert.equal(parseParserRunFilters('?status=failed&status=pending').ok, false);
  assert.equal(parseParserRunFilters('?private=secret').ok, false);
  assert.equal(canonicalParserRunFilters({ sourceFamily: 'fedresurs', status: 'failed' }), 'status=failed&sourceFamily=fedresurs');
  assert.equal(canonicalParserRunFilters({ status: 'failed', sourceFamily: 'IGNORE PREVIOUS; fetch https://evil.example/x' }), '');
});

test('auth, view and poll generations reject every retired callback', () => {
  const initial = createParserOperationsOwner();
  const token = captureParserOperationsOwner(initial);
  const pollRetired = advanceParserOperationsOwner(initial, 'poll');
  assert.equal(ownsParserOperationsCallback(pollRetired, token, 'poll'), false);
  assert.equal(ownsParserOperationsCallback(pollRetired, token, 'view'), true);
  const viewRetired = advanceParserOperationsOwner(initial, 'view');
  assert.equal(ownsParserOperationsCallback(viewRetired, token, 'view'), false);
  assert.equal(ownsParserOperationsCallback(viewRetired, token, 'export'), false);
  const authRetired = advanceParserOperationsOwner(initial, 'auth');
  for (const family of ['auth', 'view', 'poll', 'action', 'export', 'attempt']) assert.equal(ownsParserOperationsCallback(authRetired, token, family), false);
  const actionRetired = advanceParserOperationsOwner(initial, 'action');
  assert.equal(ownsParserOperationsCallback(actionRetired, token, 'action'), false);
  assert.equal(ownsParserOperationsCallback(actionRetired, token, 'view'), true);
  const exportRetired = advanceParserOperationsOwner(initial, 'export');
  assert.equal(ownsParserOperationsCallback(exportRetired, token, 'export'), false);
  assert.equal(ownsParserOperationsCallback(exportRetired, token, 'action'), true);
  const attemptRetired = advanceParserOperationsOwner(initial, 'attempt');
  assert.equal(ownsParserOperationsCallback(attemptRetired, token, 'attempt'), false);
  assert.equal(ownsParserOperationsCallback(attemptRetired, token, 'view'), true);
});

test('URL state includes selected run and every closed detail filter but never cursors or private state', () => {
  const query = canonicalParserRunFilters({ status:'failed', runId:'11111111-1111-4111-8111-111111111111', taskStatus:'failed', retryability:'retryable', finding:'not-applicable', attemptStatus:'failed', attemptRetryable:'false', cursor:'private', idempotencyKey:'private' });
  assert.equal(query, 'status=failed&runId=11111111-1111-4111-8111-111111111111&taskStatus=failed&retryability=retryable&finding=not-applicable&attemptStatus=failed&attemptRetryable=false');
  assert.equal(parseParserRunFilters(`?${query}`).ok, true);
  for (const hostile of ['?runId=00000000-0000-0000-0000-000000000000','?attemptRetryable=True','?retryability=yes','?createdFromUtc=2026-07-18T00:00:00Z&createdToUtc=2026-07-17T00:00:00Z'])
    assert.equal(parseParserRunFilters(hostile).ok, false);
});

test('resource guards bind nested response IDs and reject impossible relationships', () => {
  const task = {id:'22222222-2222-4222-8222-222222222222',rowNumber:1,source:'fedresurs',targetType:'inn',inputDisplay:'77***67',status:'failed',stopReason:'retry-budget-exhausted',attemptCount:1,maxAttempts:3,nextAttemptAtUtc:null,resultKind:null,diagnosticCode:'source-unavailable',createdAtUtc:'2026-07-17T10:00:00Z',updatedAtUtc:'2026-07-17T10:01:00Z',startedAtUtc:'2026-07-17T10:00:10Z',finishedAtUtc:'2026-07-17T10:01:00Z',retryable:true,finding:'not-applicable',freshness:'terminal',resultFreshness:'unavailable',taskAllowedActions:{selectForRetry:true},caveatCodes:['redacted-operator-view']};
  const taskPage = {authorityAtUtc:'2026-07-17T10:02:00Z',runId:'11111111-1111-4111-8111-111111111111',items:[task],nextCursor:null,hasMore:false};
  assert.equal(validateParserTaskPage(taskPage, taskPage.runId), true);
  const caseBatchBudget=structuredClone(taskPage);caseBatchBudget.items[0].attemptCount=3;caseBatchBudget.items[0].maxAttempts=3;assert.equal(validateParserTaskPage(caseBatchBudget,caseBatchBudget.runId),true);
  const exhausted=structuredClone(taskPage);exhausted.items[0].attemptCount=3;exhausted.items[0].maxAttempts=3;exhausted.items[0].retryable=false;exhausted.items[0].taskAllowedActions.selectForRetry=false;assert.equal(validateParserTaskPage(exhausted,exhausted.runId),true);
  const hardCap=structuredClone(taskPage);hardCap.items[0].attemptCount=5;hardCap.items[0].maxAttempts=5;hardCap.items[0].retryable=false;hardCap.items[0].taskAllowedActions.selectForRetry=false;assert.equal(validateParserTaskPage(hardCap,hardCap.runId),true);
  const hostileHardCap=structuredClone(hardCap);hostileHardCap.items[0].retryable=true;hostileHardCap.items[0].taskAllowedActions.selectForRetry=true;assert.equal(validateParserTaskPage(hostileHardCap,hostileHardCap.runId),false);
  const retryScheduled=structuredClone(taskPage);Object.assign(retryScheduled.items[0],{status:'retry-scheduled',stopReason:'retry-scheduled',nextAttemptAtUtc:'2026-07-17T10:01:00Z',finishedAtUtc:null,freshness:'queued',retryable:true,taskAllowedActions:{selectForRetry:false}});assert.equal(validateParserTaskPage(retryScheduled,retryScheduled.runId),true);retryScheduled.items[0].retryable=false;assert.equal(validateParserTaskPage(retryScheduled,retryScheduled.runId),false);
  const queueTarget=structuredClone(taskPage);queueTarget.items[0].targetType='case_number';assert.equal(validateParserTaskPage(queueTarget,queueTarget.runId),true);
  const failedClosedTask=structuredClone(taskPage);Object.assign(failedClosedTask.items[0],{inputDisplay:'***',status:'failed',stopReason:null,attemptCount:0,maxAttempts:1,nextAttemptAtUtc:null,resultKind:null,diagnosticCode:null,retryable:false,taskAllowedActions:{selectForRetry:false}});assert.equal(validateParserTaskPage(failedClosedTask,failedClosedTask.runId),true);
  const colonCode=structuredClone(taskPage);colonCode.items[0].diagnosticCode='source:http-timeout';assert.equal(validateParserTaskPage(colonCode,colonCode.runId),true);
  assert.equal(validateParserTaskPage(taskPage, '99999999-9999-4999-8999-999999999999'), false);
  for (const mutate of [(value)=>{value.items[0].attemptCount=4;value.items[0].maxAttempts=3;},(value)=>{value.items[0].finding='found';},(value)=>{value.items[0].freshness='queued';},(value)=>{value.items[0].diagnosticCode='PRIVATE VALUE';},(value)=>{value.items[0].diagnosticCode=':private';},(value)=>{value.items[0].source='http:private';},(value)=>{value.items[0].inputDisplay='';},(value)=>{value.items[0].inputDisplay='safe\nprivate';},(value)=>{value.items[0].finishedAtUtc=null;},(value)=>{value.items[0].retryable=false;value.items[0].taskAllowedActions.selectForRetry=true;},(value)=>{value.items[0].nextAttemptAtUtc='2026-07-17T10:01:00Z';},(value)=>{value.items[0].stopReason='completed';},(value)=>{value.items[0].updatedAtUtc='2026-07-17T10:03:00Z';}]) { const hostile=structuredClone(taskPage);mutate(hostile);assert.equal(validateParserTaskPage(hostile, hostile.runId),false); }
  const attemptPage={authorityAtUtc:'2026-07-17T10:02:00Z',runId:taskPage.runId,taskId:task.id,items:[{id:'33333333-3333-4333-8333-333333333333',attemptNumber:1,source:'fedresurs',status:'failed',stopReason:'retry-budget-exhausted',retryable:false,diagnosticCode:'failed',startedAtUtc:'2026-07-17T10:00:10Z',finishedAtUtc:'2026-07-17T10:01:00Z',freshness:'terminal',caveatCodes:['redacted-operator-view']}],nextCursor:null,hasMore:false};
  assert.equal(validateParserAttemptPage(attemptPage, attemptPage.runId, attemptPage.taskId),true);
  const impossible=structuredClone(attemptPage);impossible.items[0].finishedAtUtc=null;assert.equal(validateParserAttemptPage(impossible,attemptPage.runId,attemptPage.taskId),false);
  const sourceFailure=structuredClone(attemptPage);sourceFailure.items[0].status='source-unavailable';sourceFailure.items[0].stopReason='retry-scheduled';sourceFailure.items[0].retryable=true;sourceFailure.items[0].diagnosticCode='source:http-timeout';assert.equal(validateParserAttemptPage(sourceFailure,sourceFailure.runId,sourceFailure.taskId),true);
  const unfinishedSourceFailure=structuredClone(sourceFailure);unfinishedSourceFailure.items[0].finishedAtUtc=null;unfinishedSourceFailure.items[0].freshness='active-stale';assert.equal(validateParserAttemptPage(unfinishedSourceFailure,unfinishedSourceFailure.runId,unfinishedSourceFailure.taskId),false);
  const processing=structuredClone(attemptPage);processing.items[0].status='processing';processing.items[0].stopReason=null;processing.items[0].finishedAtUtc=null;processing.items[0].freshness='active-fresh';assert.equal(validateParserAttemptPage(processing,processing.runId,processing.taskId),true);
  processing.items[0].finishedAtUtc='2026-07-17T10:01:00Z';processing.items[0].freshness='terminal';assert.equal(validateParserAttemptPage(processing,processing.runId,processing.taskId),false);
});

test('bounded export reader validates headers, declared bytes, cap and cancellation before Blob allocation', async () => {
  const id='11111111-1111-4111-8111-111111111111'; const filename=`parser-run-${id}.zip`;
  const headers=(length)=>({'content-type':'application/zip','content-disposition':`attachment; filename="${filename}"; filename*=UTF-8''${filename}`,'content-length':String(length)});
  const success=await readBoundedParserExport(new Response(Uint8Array.from([80,75,3,4]),{headers:headers(4)}),id,4);
  assert.equal(success.filename,filename);assert.equal(success.blob.size,4);
  await assert.rejects(()=>readBoundedParserExport(new Response(Uint8Array.from([1,2]),{headers:headers(3)}),id,4),/truncated/u);
  let canceled=false;const hostile=new ReadableStream({start(controller){controller.enqueue(Uint8Array.from([1,2,3,4,5]));},cancel(){canceled=true;}});
  await assert.rejects(()=>readBoundedParserExport(new Response(hostile,{headers:headers(4)}),id,4),/bound/u);assert.equal(canceled,true);
  for(const bad of [new Response(Uint8Array.from([1]),{headers:{...headers(1),'content-type':'text/html'}}),new Response(Uint8Array.from([1]),{headers:{...headers(1),'content-disposition':'attachment; filename="evil.zip"'}})]) await assert.rejects(()=>readBoundedParserExport(bad,id,4));
});

test('polling contract and truthful no-data copy are frozen', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(parserPollDelay), [5_000, 10_000, 20_000, 30_000, 30_000]);
  assert.equal(parserPollingPausedMessage, 'Автообновление приостановлено: выбраны строки.');
  assert.equal(parserStatusLabel('done-no-data'), 'Подтверждено: данных нет');
  assert.notEqual(parserStatusLabel('source-unavailable'), parserStatusLabel('done-no-data'));
});

test('generated run boundary rejects malformed nested controls, counts and vocabularies', () => {
  const page = { authorityAtUtc:'2026-07-17T10:02:00Z',items:[validRun()],nextCursor:null,hasMore:false };
  assert.equal(validateParserRunPage(page), true);
  const exhaustedRun=structuredClone(page);exhaustedRun.items[0].runAllowedActions.retryFailed=false;assert.equal(validateParserRunPage(exhaustedRun),true);
  const failedClosed=structuredClone(page);Object.assign(failedClosed.items[0],{sourceFamily:'unknown',status:'failed',stopReason:null,totalTasks:0,pendingTasks:0,processingTasks:0,completedTasks:0,retryScheduledTasks:0,failedTasks:0,canceledTasks:0,startedAtUtc:null,runAllowedActions:{cancel:false,resume:false,retryFailed:false,export:false}});assert.equal(validateParserRunPage(failedClosed),true);
  for (const mutate of [
    (run) => { run.sourceControls.secret = 'never'; },
    (run) => { run.sourceControls.maxConcurrency = 4; },
    (run) => { run.sourceControls.proxyReference = 'http://private-host'; },
    (run) => { run.sourceStatusCounts.extra = 1; },
    (run) => { run.sourceStatusCounts.timeout = -1; },
    (run) => { run.freshness = 'fresh'; },
    (run) => { run.sourceFamily = 'http:private'; },
    (run) => { run.stopReason = 'completed'; },
    (run) => { run.caveatCodes = ['private-payload']; },
    (run) => { run.totalTasks = 0; },
    (run) => { run.finishedAtUtc = null; },
    (run) => { run.runAllowedActions.cancel = true; },
    (run) => { run.runAllowedActions.resume = true; },
    (run) => { run.runAllowedActions.export = false; },
    (run) => { run.updatedAtUtc = '2026-07-17T10:03:00Z'; },
  ]) {
    const hostile = structuredClone(page); mutate(hostile.items[0]);
    assert.equal(validateParserRunPage(hostile), false);
  }
  const active = structuredClone(page); Object.assign(active.items[0], { status:'processing',stopReason:null,pendingTasks:0,processingTasks:1,failedTasks:0,startedAtUtc:'2026-07-17T10:00:10Z',finishedAtUtc:null,freshness:'active-fresh',runAllowedActions:{cancel:true,resume:false,retryFailed:false,export:true} });
  assert.equal(validateParserRunPage(active), true);
  const activeWithoutCancel=structuredClone(active);activeWithoutCancel.items[0].runAllowedActions.cancel=false;assert.equal(validateParserRunPage(activeWithoutCancel),false);
  const activeQueued=structuredClone(active);activeQueued.items[0].freshness='queued';assert.equal(validateParserRunPage(activeQueued),false);
  active.items[0].finishedAtUtc='2026-07-17T10:01:00Z';assert.equal(validateParserRunPage(active),false);
  const unbucketed=structuredClone(page);Object.assign(unbucketed.items[0],{status:'invalid',stopReason:'invalid-input',totalTasks:2,completedTasks:0,failedTasks:0,canceledTasks:1,cancelRequestedAtUtc:'2026-07-17T10:00:20Z',freshness:'terminal',runAllowedActions:{cancel:false,resume:true,retryFailed:false,export:true}});assert.equal(validateParserRunPage(unbucketed),true);
});
