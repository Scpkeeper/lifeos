const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('www/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? e.detail.stack || e.detail : e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc
});
const { window } = dom;
const { document } = window;

// stub things jsdom lacks
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
window.HTMLAnchorElement.prototype.click = function(){}; // prevent navigation on export
window.confirm = () => true; // auto-confirm deletes

function fire(el, type='click') {
  if(!el){ errors.push('fire: element missing'); return; }
  const ev = new window.Event(type, {bubbles:true, cancelable:true});
  el.dispatchEvent(ev);
}

const results = [];
function ok(name, cond, extra='') {
  results.push((cond?'PASS':'FAIL') + ' :: ' + name + (extra?(' :: '+extra):''));
}

// ---- 1. init ran without throwing ----
ok('no init errors', errors.length === 0, errors.join(' | '));

// ---- 2. home rendered ----
const greeting = document.getElementById('homeGreeting');
ok('home greeting rendered', greeting && greeting.innerHTML.length > 50);
ok('orb present', !!document.getElementById('homeOrb'));
ok('ring pct present', !!document.getElementById('ringPct'));
ok('home plans listed', (document.getElementById('homePlans').innerHTML.match(/data-plan/g)||[]).length >= 3);

// ---- 3. tab switching ----
const navBtns = [...document.querySelectorAll('#nav button')];
ok('5 nav buttons', navBtns.length === 5);
navBtns[2].dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // plans
ok('plans tab active', document.getElementById('screen-plans').classList.contains('active'));
ok('plans filter rendered', document.getElementById('planFilter').innerHTML.includes('seg2'));

navBtns[3].dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // relations
ok('relations svg drawn', document.getElementById('relGraph').innerHTML.includes('<svg'));
ok('relations domains listed', document.getElementById('relList').innerHTML.includes('健康'));

navBtns[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // import
ok('import screen active', document.getElementById('screen-import').classList.contains('active'));

// ---- 4. create a plan via FAB ----
navBtns[2].dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // back to plans
const fab = document.getElementById('fabBtn');
fab.dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // opens FAB chips
document.getElementById('fabPlan').dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // open plan editor
const beforePlans = document.querySelectorAll('#planList [data-plan]').length;
const nameInput = document.getElementById('f_name');
ok('plan editor opened', !!nameInput);
nameInput.value = '测试计划XYZ';
// select custom type
const customBtn = [...document.querySelectorAll('#f_types button')].find(b=>b.dataset.t==='custom');
customBtn.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
document.getElementById('f_save').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const afterPlans = document.querySelectorAll('#planList [data-plan]').length;
ok('plan created', afterPlans === beforePlans + 1, `before=${beforePlans} after=${afterPlans}`);
ok('new plan persisted to localStorage', JSON.parse(window.localStorage.getItem('lifeos_v1')).plans.some(p=>p.name==='测试计划XYZ'));

// ---- 5. add a task to that plan ----
const newPlanEl = [...document.querySelectorAll('#planList [data-plan]')].find(e=>{
  return e.querySelector('div') && e.textContent.includes('测试计划XYZ');
});
newPlanEl.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
document.getElementById('pv_add').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const tTitle = document.getElementById('t_title');
ok('task editor opened', !!tTitle);
tTitle.value = '子任务ABC';
document.getElementById('t_save').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const newPlan = JSON.parse(window.localStorage.getItem('lifeos_v1')).plans.find(p=>p.name==='测试计划XYZ');
ok('task added to plan', newPlan && newPlan.tasks.length === 1 && newPlan.tasks[0].title==='子任务ABC');

// ---- 6. markdown import -> preview -> extract ----
navBtns[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
document.getElementById('mdInput').value = '# 测试笔记\n\n- [ ] 任务一\n- [x] 已完成\n';
document.getElementById('btnPreview').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('preview rendered', document.getElementById('previewCard').style.display === 'block' && document.getElementById('mdPreview').innerHTML.includes('<li'));
document.getElementById('btnExtract').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('extract sheet opened', document.getElementById('sheetBody').innerHTML.includes('提取任务到计划'));
document.getElementById('ex_ok').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const allTasks = JSON.parse(window.localStorage.getItem('lifeos_v1')).plans.flatMap(p=>p.tasks);
ok('task extracted from md', allTasks.some(t=>t.title==='任务一'));

// ---- 6b. edit + delete task ----
const LS=()=>JSON.parse(window.localStorage.getItem('lifeos_v1'));
const npEl=[...document.querySelectorAll('#planList [data-plan]')].find(e=>e.textContent.includes('测试计划XYZ'));
npEl.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const editBtn=document.querySelector('#pvTasks .task div[onclick^="__editTask"]');
ok('edit-task affordance present', !!editBtn);
editBtn.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('edit task sheet opened', !!document.getElementById('t_title'));
document.getElementById('t_title').value='子任务ABC改';
document.getElementById('t_save').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('task edited', LS().plans.find(p=>p.name==='测试计划XYZ').tasks[0].title==='子任务ABC改');
const delBtn=document.querySelector('#pvTasks .t-del');
ok('delete-task button present', !!delBtn);
delBtn.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('task deleted', LS().plans.find(p=>p.name==='测试计划XYZ').tasks.length===0);

// ---- 6c. save + delete note ----
navBtns[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
document.getElementById('mdInput').value='# 笔记待删\n\n- [ ] x';
document.getElementById('btnPreview').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
document.getElementById('btnSaveNote').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const notesBefore=LS().notes.length;
ok('note saved', notesBefore>=1);
const noteEl=document.querySelector('#noteList [data-note]');
noteEl.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('note view has delete', !!document.querySelector('#sheetBody button[onclick^="__delNote"]'));
document.querySelector('#sheetBody button[onclick^="__delNote"]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('note deleted', LS().notes.length===notesBefore-1);

// ---- 6d. AI auto-classify (on-device) ----
const L=window.LifeOS;
const aiMd="# 我的方案\n\n## 读书计划\n- [ ] 每天阅读 30 分钟\n- [ ] 写读书笔记\n\n## 健身计划\n- [ ] 晨跑 5 公里\n- [ ] 力量训练 20 分钟\n\n## 饮食计划\n- [ ] 早餐补充蛋白质";
const sugg = L.AIHub.heuristic(aiMd);
ok('ai classify returns plans', sugg.plans.length >= 3, 'n='+sugg.plans.length);
ok('ai assigns reading type', sugg.plans.some(p=>p.type==='reading'));
ok('ai assigns fitness type', sugg.plans.some(p=>p.type==='fitness'));
ok('ai assigns diet type', sugg.plans.some(p=>p.type==='diet'));
ok('ai extracts tasks', sugg.plans.reduce((n,p)=>n+p.tasks.length,0) >= 5, 'tasks='+sugg.plans.reduce((n,p)=>n+p.tasks.length,0));
const aiRes = L.applyAI(sugg);
ok('ai apply did not crash', typeof aiRes.total === 'number', 'total='+aiRes.total);
ok('ai apply added tasks to plans', LS().plans.flatMap(p=>p.tasks).length > 0);
ok('ai links array exists', Array.isArray(LS().links));
// graph node position persistence
L.data.graph.nodes['p_read'] = {x:123,y:45};
const posBefore = JSON.stringify(L.data.graph.nodes['p_read']);
L.renderRelations();
ok('graph node position persisted across render', JSON.stringify(L.data.graph.nodes['p_read']) === posBefore);
ok('relSvg + relView present', !!document.getElementById('relSvg') && !!document.getElementById('relView'));
ok('relGraph has plan nodes', (document.getElementById('relGraph').innerHTML.match(/data-node="plan"/g)||[]).length >= 3);

// ---- 7. theme toggle ----
navBtns[4].dispatchEvent(new window.MouseEvent('click',{bubbles:true})); // profile
document.getElementById('thmLight').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('theme -> light', document.documentElement.dataset.theme === 'light');
document.getElementById('thmDark').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
ok('theme -> dark', document.documentElement.dataset.theme === 'dark');

// ---- 8. notifications toggle (web path) ----
// Notification stub
let notifGranted = true;
window.Notification = function(){}; 
window.Notification.permission = 'granted';
window.Notification.requestPermission = () => Promise.resolve('granted');
document.getElementById('btnNotif').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
// async; check after tick
setTimeout(() => {
  ok('notif enabled', JSON.parse(window.localStorage.getItem('lifeos_v1')).settings.notif === true,
     'pill=' + document.getElementById('notifPill').textContent);

  // ---- 9. export (should not throw) ----
  let exportThrew = false;
  try { document.getElementById('btnExport').dispatchEvent(new window.MouseEvent('click',{bubbles:true})); }
  catch(e){ exportThrew = true; errors.push('export threw: '+e.message); }
  ok('export no throw', !exportThrew);

  console.log('\n===== SMOKE TEST RESULTS =====');
  results.forEach(r=>console.log(r));
  console.log('\n===== ERRORS ('+errors.length+') =====');
  errors.forEach(e=>console.log(e));
  const failed = results.filter(r=>r.startsWith('FAIL')).length;
  console.log('\nSUMMARY: '+(results.length-failed)+'/'+results.length+' passed, '+errors.length+' runtime errors');
  process.exit(failed>0 || errors.length>0 ? 1 : 0);
}, 150);
