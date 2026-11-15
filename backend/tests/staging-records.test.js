'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BE = require('../../web/pactfit-be');
const rows = [
  {id:1,owner_id:'A',space_id:'space-a',record_date:'2026-11-14',weight:70,note:'昨天'},
  {id:2,owner_id:'B',space_id:'space-a',record_date:'2026-11-15',weight:90,note:'其他人的记录'},
  {id:3,owner_id:'A',space_id:'space-b',record_date:'2026-11-15',weight:80,note:'其他空间'},
  {id:4,owner_id:'A',space_id:'space-a',record_date:'2026-11-15',weight:69.5,mood:'还不错',note:'备注 <script>alert(1)</script>'}
];
const before = JSON.stringify(rows);
const summary = BE.summarizeSavedRecords(rows,'A','space-a','2026-11-15');
assert.equal(summary.count,2);
assert.equal(summary.days,2);
assert.equal(summary.latest.id,4);
assert.equal(summary.today.id,4);
assert.deepEqual(summary.rows.map(r=>r.id),[4,1]);
assert.equal(JSON.stringify(rows),before);
assert.equal(BE.summarizeSavedRecords(rows,'new-account','space-a','2026-11-15').count,0);
assert.equal(BE.summarizeSavedRecords(rows,'A','space-a','2026-11-16').today,null);
const source = fs.readFileSync(require('node:path').join(__dirname,'../../web/index.html'),'utf8');
const helpers = source.slice(source.indexOf('function savedRecordsSummary(){'),source.indexOf('function renderHome(){'));
const state = {records:rows,space:'space-a',draft:{weight:69.5,note:rows[3].note,mood:'还不错',tags:[],todoDone:[]}};
const context = {PactFitBE:BE,S:state,uid:'A',todayStr:()=> '2026-11-15',n1:n=>Number(n).toFixed(1),esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])};
vm.createContext(context);vm.runInContext(helpers,context);
const card=context.savedRecordsCard(true);
assert.match(card,/今日打卡已保存/);
assert.match(card,/已保存 2 条打卡/);
assert.equal(card.includes('<script>'),false);
assert.match(card,/&lt;script&gt;/);
assert.equal(card.includes('其他人的记录'),false);
assert.equal(card.includes('其他空间'),false);
assert.equal(context.savedRecordsCard(false).includes('<button'),false);
assert.match(context.savedRecordsHistory(),/我的打卡历史/);
assert.equal(context.recordDraftChanged(rows[3]),false);
state.draft.note='尚未保存的草稿';
assert.equal(context.recordDraftChanged(rows[3]),true);
assert.equal(context.savedRecordsCard(false).includes('尚未保存的草稿'),false);
state.records=[];
assert.match(context.savedRecordsCard(false),/起始体重不计为打卡/);
console.log('PASS saved records: account/space isolation, reload projection, history, escaped notes, empty state, draft separated from saved data');
