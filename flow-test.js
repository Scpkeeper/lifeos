const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('www/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? e.detail.stack || e.detail : e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
window.HTMLAnchorElement.prototype.click = function(){};
window.confirm = () => true;

const results = [];
function ok(name, cond, extra='') { results.push((cond?'PASS':'FAIL') + ' :: ' + name + (extra?(' :: '+extra):'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const L = window.LifeOS;
  if(!L){ ok('LifeOS exposed', false); finish(); return; }
  const data = L.data;

  // seed an existing plan in 健康(d_health) to test GLOBAL association
  const existingId = 'p_existing_fit';
  data.plans.push({id:existingId, name:'已有健身计划', type:'fitness', domainId:'d_health', tasks:[]});
  L.renderPlans && L.renderPlans();

  const notesBefore = data.notes.length;
  const md = '明早8点提醒我吃药，这周把《活着》读完，顺便每天跑步30分钟减肥';
  const input = document.getElementById('mdInput');
  input.value = md;

  // trigger the AI review flow
  L.openAIReview(md);
  await sleep(80); // allow async classify + renderAIReview

  const applyBtn = document.getElementById('aiApply');
  ok('confirm page rendered (确定并执行)', !!applyBtn);
  const noteBadge = (document.getElementById('aiBody')||{}).innerHTML || '';
  ok('note-saved badge shown', noteBadge.includes('已存为笔记'), '');
  ok('note auto-saved into data', data.notes.length === notesBefore + 1, 'notes '+notesBefore+'->'+data.notes.length);
  ok('saved note has the md', data.notes.some(n => n.md === md));

  // de-select nothing; click 确定并执行
  applyBtn && applyBtn.click();
  await sleep(40);

  const linksToExisting = data.links.filter(l => l.a === existingId || l.b === existingId);
  ok('global association: new plan linked to existing same-domain plan', linksToExisting.length >= 1, 'linksToExisting='+linksToExisting.length);
  const hasReminder = data.todos.some(t => t.title.includes('吃药'));
  // "把《活着》读完" is a reading GOAL -> classified as a reading PLAN (not a free todo)
  const hasReadingPlan = data.plans.some(p => p.type==='reading' && (p.name.includes('活着') || (p.tasks||[]).some(t=>t.title && t.title.includes('活着'))));
  ok('reminder added', hasReminder);
  ok('reading plan created for 《活着》', hasReadingPlan);
  ok('no runtime errors', errors.length === 0, errors.join(' | '));

  finish();
})();

function finish(){
  console.log(results.join('\n'));
  const fails = results.filter(r=>r.startsWith('FAIL'));
  console.log('\n' + (fails.length? ('FAILURES: '+fails.length) : 'ALL PASS') + '  ('+results.length+' checks)');
  process.exit(fails.length?1:0);
}
