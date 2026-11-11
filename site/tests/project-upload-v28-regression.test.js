import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {detectImageMime} from '../server/media-validation.js';

const here=dirname(fileURLToPath(import.meta.url));
const source=name=>readFileSync(resolve(here,'..',name),'utf8');

test('project Firestore create rule does not demand a field absent from project submission',()=>{
 const rules=source('firestore.rules');
 const projectBlock=rules.split('match /projects/{projectId} {')[1]?.split('match /downloadQuotas/{quotaId} {')[0];
 assert.ok(projectBlock,'project creation rule exists');
 assert.doesNotMatch(projectBlock,/request\.resource\.data\.paymentMethod/);
 assert.match(projectBlock,/request\.resource\.data\.authorId == request\.auth\.uid/);
 assert.match(projectBlock,/request\.resource\.data\.status == 'pending'/);
 assert.match(projectBlock,/request\.resource\.data\.fileKey == 'projects\/'/);
});

test('project image content-type follows verified bytes, not an unreliable Android filename',()=>{
 const stagedSource=source('server/api.js');
 const jpeg=Uint8Array.of(0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0);
 assert.equal(detectImageMime(jpeg),'image/jpeg');
 assert.match(stagedSource,/imageMime=imageTypeOrThrow\(bytes\.subarray\(0,32\)\)/);
 assert.doesNotMatch(stagedSource,/detected!==imageMime/);
 assert.match(stagedSource,/contentType:isImage\?imageMime/);
 assert.match(stagedSource,/if\(isImage&&!imageMime\)/);
});

test('upload transport and 3MB project limits unchanged',()=>{
 const project=source('src/project-upload.js');
 const mobile=source('src/mobile-file.js');
 const server=source('server/api.js');
 assert.match(project,/submitProjectWithFallback/);
 assert.match(project,/stageAsset\('projects', submissionId, 'file', file\)/);
 assert.match(project,/stageAsset\('projects', submissionId, 'image', image\)/);
 assert.match(server,/mode==='file'&&!isSupportedProjectFile/);
 assert.match(mobile,/snapshotUploadFile/);
});
