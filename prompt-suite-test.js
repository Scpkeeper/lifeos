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

// wait for DOMContentLoaded / init
setTimeout(async () => {
  try {
    const w = window;
    const L = w.LifeOS;
    ok('LifeOS exposed', !!L);
    // 1. AIPrompts object exists with all 7 prompts
    const prompts = ['main','whisper','matchPlan','today','chat','clarify','relations'];
    ok('AIPrompts has 7 prompts', prompts.every(k => typeof L.AIPrompts[k] === 'string' && L.AIPrompts[k].length > 20),
       prompts.filter(k => !L.AIPrompts[k]).join(','));

    // 2. heuristic produces notes + entities for person mention + idea sentence
    const md = '张三说周五前把方案发我，今天好累，感觉健身计划执行不下去了，这周把《活着》读完';
    const r = L.AIHub.heuristic(md);
    ok('heuristic: entities has 张三', (r.entities||[]).some(e => e.name === '张三' && e.type === 'person'),
       'entities=' + (r.entities||[]).map(e=>e.name).join(','));
    ok('heuristic: notes has idea sentence', (r.notes||[]).length >= 1, 'notes=' + (r.notes||[]).length);
    ok('heuristic: reading plan for 《活着》', (r.plans||[]).some(p => /活着/.test(p.title)),
       'plans=' + (r.plans||[]).map(p=>p.title).join(','));

    // 3. classify (engine=heuristic default) also returns notes/entities (async!)
    const c = await L.AIHub.classify(md);
    ok('classify: notes present', (c.notes||[]).length >= 1);
    ok('classify: entities present', (c.entities||[]).length >= 1);

    // 4. applyAI persists notes + entities
    const beforeNotes = L.data.notes.length, beforeEnt = L.data.entities.length;
    const applied = L.applyAI(r);
    ok('applyAI: notes persisted', L.data.notes.length > beforeNotes, 'new=' + (L.data.notes.length - beforeNotes));
    ok('applyAI: entities persisted', L.data.entities.length > beforeEnt, 'new=' + (L.data.entities.length - beforeEnt));
    ok('applyAI: return counts notes/entities', applied.notes >= 1 && applied.entities >= 1,
       JSON.stringify({notes:applied.notes, entities:applied.entities}));

    // 5. renderAIReview renders notes + entities sections into #aiBody (async render)
    L.ensureImportNote(md);
    L.openAIReview(md);
    await new Promise(r => setTimeout(r, 120));
    const body = document.getElementById('aiBody');
    ok('renderAIReview: 笔记/想法 section', !!body && body.innerHTML.indexOf('笔记 / 想法') >= 0);
    ok('renderAIReview: 人物/项目 section', !!body && body.innerHTML.indexOf('人物 / 项目') >= 0);

    // 6. renderEntities shows extracted person in #relEntities
    L.renderRelations(); L.renderEntities();
    const rel = document.getElementById('relEntities');
    ok('renderEntities: shows 张三', !!rel && rel.innerHTML.indexOf('张三') >= 0);

  } catch (e) {
    ok('test harness threw', false, e.message + '\n' + e.stack);
  }
  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed ? ('\nFAILED: ' + failed) : '\nALL PASS  (' + results.length + ' checks)');
  if (errors.length) console.log('RUNTIME ERRORS:\n' + errors.join('\n'));
  process.exit(failed || errors.length ? 1 : 0);
}, 300);
