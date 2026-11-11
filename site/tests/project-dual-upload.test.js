import test from 'node:test';
import assert from 'node:assert/strict';
import {submitProjectWithFallback,canTryDirectProjectUpload} from '../src/project-upload.js';
const submissionId = '6fafc725-1aa4-47d6-95ac-9f4ef4612318';
const fields={title:'بوت واتساب للمطورين',description:'مشروع بوت كامل مع أدوات الإدارة وأوامر ومميزات متعددة',category:'whatsapp',forSale:false};
const image=new File([Uint8Array.of(255,216,255,224)],'cover.jpg',{type:'image/jpeg'});
const file=new File(['console.log(1)'],'api.js',{type:'application/javascript'});

test('staged project upload succeeds and final metadata never resends binary assets',async()=>{
  const stages=[];let body=null;
  const result=await submitProjectWithFallback({fields,submissionId,image,file,
    stageAsset:async(...args)=>{stages.push(args.slice(0,3));return {received:true}},
    uploadFile:async(path,form)=>{assert.equal(path,'projects');body=form;return {status:'pending'}}
  });
  assert.deepEqual(result,{status:'pending'});
  assert.deepEqual(stages,[['projects',submissionId,'image'],['projects',submissionId,'file']]);
  assert.equal(body.get('stagedAssets'),'1');
  assert.equal(body.get('image'),null);
  assert.equal(body.get('file'),null);
});

test('lost staging connection switches to multipart with BOTH files and same submissionId',async()=>{
  const calls=[];let uploads=0;
  const result=await submitProjectWithFallback({fields,submissionId,image,file,
    stageAsset:async(_section,_id,slot)=>{calls.push(slot);if(slot==='file')throw Object.assign(new Error('connection lost'),{code:'NETWORK'});return {received:true}},
    uploadFile:async(path,form)=>{uploads++;assert.equal(path,'projects');assert.equal(form.get('submissionId'),submissionId);assert.equal(form.get('stagedAssets'),null);assert.equal(form.get('image').name,'cover.jpg');assert.equal(form.get('file').name,'api.js');return {id:submissionId,status:'pending'}}
  });
  assert.equal(result.id,submissionId);assert.equal(uploads,1);assert.deepEqual(calls,['image','file']);
});

test('HTTP 403, validation 413 and invalid file NEVER trigger fallback that bypasses security',async()=>{
  for(const error of [Object.assign(new Error('Forbidden'),{status:403}),Object.assign(new Error('Too big'),{status:413}),new Error('invalid file')]){
    let uploadCalls=0;
    await assert.rejects(submitProjectWithFallback({fields,submissionId,image,file,
      stageAsset:async()=>{throw error},uploadFile:async()=>{uploadCalls++}}),e=>e===error);
    assert.equal(uploadCalls,0);
  }
});

test('two failed upload paths preserve both original causes in useful diagnostic error',async()=>{
  await assert.rejects(submitProjectWithFallback({fields,submissionId,file,
    stageAsset:async()=>{throw Object.assign(new Error('R2 stage timed out'),{code:'NETWORK'})},
    uploadFile:async()=>{throw new Error('multipart HTTP 502')}
  }),/R2 stage timed out.*multipart HTTP 502/);
});

test('Only transient failures qualify for one fallback',()=>{
  assert.equal(canTryDirectProjectUpload({status:503}),true);
  assert.equal(canTryDirectProjectUpload({kind:'INVALID_RESPONSE'}),true);
  assert.equal(canTryDirectProjectUpload({status:401}),false);
  assert.equal(canTryDirectProjectUpload({status:413}),false);
});
