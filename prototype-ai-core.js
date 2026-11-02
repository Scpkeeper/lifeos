/* ============================================================================
 * LifeOS · 端侧大模型原型共享内核 (prototype-ai-core.js)
 * ----------------------------------------------------------------------------
 * 提供三个原型共用的能力：
 *   1) ModelPreloader  —— 端侧模型预载（安装即预载 / 首次使用提示预载）
 *   2) LocalLLM        —— 端侧语言模型自动分析（stub 即时 + WebLLM 真·端侧）
 *   3) Whisper         —— 端侧语音转写（transformers.js WASM，离线中文）
 *   4) 共享液态玻璃主题 + 渲染辅助
 *
 * 设计要点：原型默认走 stub 分析器（零下载、即时、可离线演示）；
 * 把 AICore.LocalLLM.backend 切到 'webllm' 即可调用真实端侧大模型
 * （Qwen2.5-0.5B，约 520MB，首次从 CDN 下载并缓存，之后完全离线）。
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ---------- 1. 模型清单 & 预载策略 ---------- */
  const MODELS = {
    whisper: {
      id: 'Xenova/whisper-tiny',
      label: 'Whisper 语音识别',
      sizeMB: 75,
      kind: 'asr'
    },
    llm: {
      id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      label: 'Qwen2.5 端侧语言模型',
      sizeMB: 520,
      kind: 'llm'
    }
  };

  const ModelPreloader = {
    KEY: 'lifeos_models_v1',
    _state: null,
    _load() {
      if (this._state) return this._state;
      try { this._state = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
      catch (e) { this._state = {}; }
      return this._state;
    },
    _save() { try { localStorage.setItem(this.KEY, JSON.stringify(this._state)); } catch (e) {} },
    isReady(name) { return !!this._load()[name]; },
    setReady(name, v) { this._load()[name] = !!v; this._save(); },
    /* 模拟下载进度（真实场景应触发 loadWhisper/loadLLM 并由 Cache API 缓存）。
     * 用 onProgress(0..1) 回调驱动 UI，完成后标记 ready。 */
    preload(name, opts) {
      opts = opts || {};
      const onProgress = opts.onProgress || function () {};
      const m = MODELS[name];
      if (!m) return Promise.reject(new Error('未知模型: ' + name));
      // 真实预载时这里改为：await AICore.loadWhisper() / AICore.loadLLM()
      // 二者内部经由 transformers.js / WebLLM 把权重写入 Cache API，之后离线可用。
      return new Promise((resolve) => {
        let p = 0;
        const tick = () => {
          p += 0.04 + Math.random() * 0.06;
          if (p >= 1) { p = 1; onProgress(1); this.setReady(name, true); resolve(); }
          else { onProgress(p); setTimeout(tick, 90); }
        };
        setTimeout(tick, 120);
      });
    }
  };

  /* ---------- 2. 共享领域 / 类型定义（与 App 对齐） ---------- */
  const TYPES = {
    reading: { name: '读书', icon: '📚', color: '#6ea8ff' },
    fitness: { name: '健身', icon: '🏃', color: '#5fe6d4' },
    diet:    { name: '饮食', icon: '🥗', color: '#ffb86b' },
    custom:  { name: '自定义', icon: '⭐', color: '#b794f6' }
  };
  const DOMAINS = [
    { id: 'd_health', name: '健康', color: '#5fe6d4' },
    { id: 'd_growth', name: '成长', color: '#6ea8ff' },
    { id: 'd_career', name: '事业', color: '#ffb86b' },
    { id: 'd_life',   name: '生活', color: '#b794f6' }
  ];
  function domainName(id) { const d = DOMAINS.find(x => x.id === id); return d ? d.name : '未分类'; }
  function domainColor(id) { const d = DOMAINS.find(x => x.id === id); return d ? d.color : '#8aa0b4'; }

  /* ---------- 3. 文本工具 ---------- */
  function splitClauses(text) {
    if (!text) return [];
    // 先按显式连接词断开，再按标点断开
    let s = text.replace(/然后|顺便|还有|以及|另外|同时|并且|而且|，?并且|，?而且/g, '|');
    s = s.split(/[，。；、,;.\n|]+/).map(x => x.trim()).filter(Boolean);
    return s;
  }
  function detectTime(cl) {
    const t = cl;
    const map = [
      [/明早|明天早上|明晨/, '明早'],
      [/明天|次日/, '明天'],
      [/今晚|今夜/, '今晚'],
      [/今天|今日/, '今天'],
      [/早上|上午/, '早上'],
      [/下午/, '下午'],
      [/晚上|夜里|夜间/, '晚上'],
      [/周末/, '周末'],
      [/下周|下星期/, '下周'],
      [/下周|下月|下个月/, '下月'],
      [/本周|这周|这星期/, '本周'],
      [/本月|这个月/, '本月']
    ];
    let day = null;
    for (const [re, label] of map) if (re.test(t)) { day = label; break; }
    const hm = t.match(/(\d{1,2})\s*[:：点]\s*(\d{1,2})?\s*(分|分钟)?/);
    let at = null;
    if (day && hm) at = day + hm[1] + '点' + (hm[2] ? hm[2] + '分' : '');
    else if (day) at = day;
    else if (hm) at = hm[1] + '点' + (hm[2] ? hm[2] + '分' : '');
    let repeat = null;
    if (/每天|每日|天天/.test(t)) repeat = '每天';
    else if (/每周|每星期|周[一二三四五六日天]/.test(t)) repeat = '每周';
    else if (/每月|每个月/.test(t)) repeat = '每月';
    else if (/一直|长期|习惯|常年/.test(t)) repeat = '长期';
    return at ? { label: at, repeat } : (repeat ? { label: null, repeat } : null);
  }
  function detectFreq(cl) {
    if (/每天|每日|天天/.test(cl)) return { type: 'daily', label: '每天' };
    if (/每周|每星期|周[一二三四五六日天]/.test(cl)) return { type: 'weekly', label: '每周' };
    if (/每月|每个月/.test(cl)) return { type: 'monthly', label: '每月' };
    if (/这周|本周|这星期/.test(cl)) return { type: 'week', label: '本周' };
    if (/一直|长期|习惯|常年/.test(cl)) return { type: 'forever', label: '长期' };
    return { type: 'none', label: '' };
  }
  function detectPlanType(cl) {
    const t = cl.toLowerCase();
    if (/(读|书|阅读|笔记|学习|学|课程|论文|paper|book|read|study|learn|背单词|背\d+个)/.test(cl)) return 'reading';
    if (/(跑|健身|运动|训练|拉伸|力量|瑜伽|有氧|游泳|骑车|骑行|walk|run|jog|gym|workout|exercise|fitness|公里|千?米)/.test(cl)) return 'fitness';
    if (/(饮食|吃|餐|营养|蛋白|碳水|减脂|减肥|增肌|喝水|meal|diet|nutrition|protein|carb)/.test(cl)) return 'diet';
    if (/(项目|计划|目标|坚持|完成|开始|养成)/.test(cl)) return 'custom';
    return null;
  }
  function detectDomain(cl) {
    const t = cl.toLowerCase();
    const DOM = {
      d_health: ['健康', '身体', '健身', '运动', '饮食', '睡眠', '体重', '药', '喝水', 'weight', 'health'],
      d_growth: ['成长', '学习', '读书', '技能', '阅读', '课程', '单词', 'skill', 'grow'],
      d_career: ['工作', '事业', '项目', '会议', '客户', '产出', '业务', 'work', 'project', 'meeting', 'career'],
      d_life:   ['生活', '关系', '家庭', '旅行', '朋友', '妈妈', '家人', 'life', 'family']
    };
    let best = 'd_life', score = 0;
    for (const k in DOM) { let s = 0; DOM[k].forEach(kw => { if (t.includes(kw.toLowerCase())) s++; }); if (s > score) { score = s; best = k; } }
    if (score === 0) {
      const type = detectPlanType(cl);
      best = { reading: 'd_growth', fitness: 'd_health', diet: 'd_health', custom: 'd_life' }[type] || 'd_life';
    }
    return best;
  }
  function detectTodoVerb(cl) {
    return /(买|做|打电话|交|寄|预约|办理|回复|写|完成|取|拿|接|提交|处理|整理|准备|打扫|洗)/.test(cl);
  }
  function cleanClause(cl, keepTime) {
    let s = cl.replace(/^(然后|顺便|还有|以及|另外|同时|并且|而且)[，, ]*/, '')
              .replace(/提醒我|记得|别忘了|别忘记|记着|记得到|提醒一下|remind me to|remember to/gi, '')
              .replace(/^我(要|想|得|需要|应该)?/, '')
              .replace(/把|给|去|到/g, '').trim();
    if (!keepTime) s = s.replace(/明早|明天|今晚|今天|早上|下午|晚上|周末|下周|下月|本周|本月|\d{1,2}\s*[:：点]\s*\d{0,2}\s*(分|分钟)?|每天|每日|每周|每月|一直|长期|习惯/g, '').trim();
    return s || cl.trim();
  }
  function extractTopics(text) {
    const toks = (text || '').toLowerCase().match(/[一-龥]{2,}|[a-z]{3,}/g) || [];
    return toks.filter(w => !/然后|顺便|还有|以及|提醒|记得|每天|每周|每月|今天|明天|早上|下午|晚上|完成|开始|计划|目标/.test(w));
  }
  function overlap(a, b) {
    const A = extractTopics(a), B = extractTopics(b);
    let n = 0; A.forEach(x => { if (B.includes(x)) n++; }); return n;
  }

  /* ---------- 4. stub 分析器（即时、离线、零下载） ---------- */
  function stubAnalyze(text) {
    const raw = (text || '').trim();
    const clauses = splitClauses(raw);
    const plans = [], todos = [], reminders = [], links = [];
    const clut = (w) => w.toLowerCase();

    clauses.forEach((cl, ci) => {
      const time = detectTime(cl);
      const freq = detectFreq(cl);
      const dom = detectDomain(cl);
      const isRemind = /提醒|记得|别忘|别忘了|记着|记得到|提醒一下|remind|remember/.test(cl);
      const ptype = detectPlanType(cl);
      const hasGoal = /读完|学会|学完|完成|开始|坚持|养成|目标|计划|减(脂|肥)|增肌/.test(cl);
      const todoVerb = detectTodoVerb(cl);

      if (isRemind || (time && /吃药|喝水|起床|睡觉|会议|打电话|取|拿|接|交|寄/.test(cl))) {
        reminders.push({ id: 'r' + ci, text: cleanClause(cl, true), at: time ? time.label : null, repeat: time ? time.repeat : null, domain: dom });
      } else if (ptype && (freq.type !== 'none' || hasGoal || ptype === 'reading')) {
        const title = planTitle(cl, ptype);
        const tasks = extractTasks(cl);
        plans.push({
          id: 'p' + ci, title, type: ptype, domain: dom,
          frequency: freq, tasks,
          deadline: freq.type === 'week' ? (time ? time.label : '本周') : null
        });
      } else if (todoVerb) {
        todos.push({
          id: 't' + ci, text: cleanClause(cl, false),
          due: time ? time.label : null,
          priority: /重要|紧急|尽快|必须|一定|赶紧/.test(cl) ? 'high' : 'normal',
          domain: dom, planType: ptype
        });
      }
    });

    // 兜底：没有任何实体时，整句作为一条待办
    if (!plans.length && !todos.length && !reminders.length && raw) {
      todos.push({ id: 't0', text: raw, due: null, priority: 'normal', domain: detectDomain(raw), planType: detectPlanType(raw) });
    }

    buildLinks(plans, reminders, todos, links);

    const n = plans.length + todos.length + reminders.length;
    const summary = '端侧分析完成：' + plans.length + ' 个计划、' + todos.length + ' 项待办、' +
      reminders.length + ' 条提醒' + (links.length ? '，已自动建立 ' + links.length + ' 处关联。' : '。');
    return { intent: n > 1 ? 'mixed' : 'single', plans, todos, reminders, links, summary, engine: 'stub' };
  }

  function planTitle(cl, ptype) {
    let s = cl.replace(/^(然后|顺便|还有|以及|另外|同时)[，, ]*/, '')
              .replace(/把|给|去|到|我(要|想|得|需要|应该)?|每天|每日|每周|每月|这周|本周|一直|长期|习惯|坚持|开始|养成/g, '')
              .replace(/读完|学会|学完|完成|减(脂|肥)|增肌/g, '')
              .replace(/\d{1,2}\s*[:：点]\s*\d{0,2}\s*(分|分钟)?/g, '')
              .replace(/《|》|」|「/g, '')
              .trim();
    if (ptype === 'reading') { const m = cl.match(/《([^》]+)》|"([^"]+)"|([A-Za-z0-9_: ]{2,})/); if (m) s = (m[1] || m[2] || m[3] || s).trim(); }
    if (!s) s = TYPES[ptype].name + '计划';
    return s.slice(0, 18);
  }
  function extractTasks(cl) {
    const tasks = [];
    const ms = cl.match(/每天[^，。；,;]+|每周[^，。；,;]+|每[^，。；,;]+次|(\d+)\s*(公里|千?米|分钟|组|个)/g);
    if (ms) ms.forEach(m => tasks.push(m.trim()));
    if (!tasks.length) {
      const m = cl.match(/《([^》]+)》|"([^"]+)"/);
      if (m) tasks.push('读完《' + (m[1] || m[2]) + '》');
    }
    return tasks.slice(0, 4).map(t => ({ text: t }));
  }
  function buildLinks(plans, reminders, todos, links) {
    // plan ↔ plan（同领域）
    for (let i = 0; i < plans.length; i++)
      for (let j = i + 1; j < plans.length; j++)
        if (plans[i].domain === plans[j].domain)
          links.push({ from: plans[i].id, to: plans[j].id, kind: 'plan-plan', relation: '同属「' + domainName(plans[i].domain) + '」' });
    // reminder ↔ plan（主题重叠，或同领域且仅有一个该领域计划）
    const planByDomain = {};
    plans.forEach(p => { planByDomain[p.domain] = (planByDomain[p.domain] || 0) + 1; });
    reminders.forEach(r => plans.forEach(p => {
      const sameDomSingle = (r.domain === p.domain && planByDomain[p.domain] === 1);
      if (overlap(r.text, p.title) >= 1 || overlap(r.text, TYPES[p.type] ? TYPES[p.type].name : '') >= 1 || sameDomSingle)
        links.push({ from: r.id, to: p.id, kind: 'reminder-plan', relation: sameDomSingle ? '同属「' + domainName(r.domain) + '」的提醒与计划' : '提醒服务于该计划' });
    }));
    // todo ↔ plan（主题重叠）
    todos.forEach(t => plans.forEach(p => {
      if (overlap(t.text, p.title) >= 1)
        links.push({ from: t.id, to: p.id, kind: 'todo-plan', relation: '待办支撑该计划' });
    }));
  }

  /* ---------- 5. WebLLM 真·端侧大模型（可选后端） ---------- */
  async function webllmAnalyze(text, opts) {
    opts = opts || {};
    const sys = '你是 LifeOS 的端侧助理。把用户的一句话整理成 JSON，只输出 JSON，不要任何多余文字。' +
      '结构：{intent:"mixed"|"single", plans:[{title,type:"reading"|"fitness"|"diet"|"custom",domain:"d_health"|"d_growth"|"d_career"|"d_life",frequency:{type:"daily"|"weekly"|"monthly"|"week"|"forever"|"none",label},tasks:[{text}],deadline}],' +
      'todos:[{text,due,priority:"high"|"normal",domain}], reminders:[{text,at,repeat}], ' +
      'links:[{from,to,kind:"plan-plan"|"reminder-plan"|"todo-plan",relation}]}。domain 取值：健康d_health 成长d_growth 事业d_career 生活d_life。';
    let mod;
    try { mod = await import('https://esm.run/@mlc-ai/web-llm'); }
    catch (e) { throw new Error('无法加载端侧大模型库 (@mlc-ai/web-llm)'); }
    const onProg = opts.onProgress || function () {};
    const engine = await mod.CreateMLCEngine(MODELS.llm.id, {
      initProgressCallback: (r) => { if (r && typeof r.progress === 'number') onProg(r.progress); }
    });
    const res = await engine.chat.completions.create({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
      temperature: 0.2, max_tokens: 1400
    });
    const txt = (res.choices[0].message.content || '');
    const js = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    const json = JSON.parse(js);
    // 规范化
    const plans = (json.plans || []).map(p => ({
      id: 'p' + Math.random().toString(36).slice(2, 7),
      title: (p.title || '').slice(0, 18),
      type: ['reading', 'fitness', 'diet', 'custom'].includes(p.type) ? p.type : 'custom',
      domain: ['d_health', 'd_growth', 'd_career', 'd_life'].includes(p.domain) ? p.domain : 'd_life',
      frequency: p.frequency || { type: 'none', label: '' },
      tasks: (p.tasks || []).map(t => ({ text: (typeof t === 'string' ? t : t.text) || '' })),
      deadline: p.deadline || null
    }));
    const todos = (json.todos || []).map(t => ({
      id: 't' + Math.random().toString(36).slice(2, 7),
      text: t.text || '', due: t.due || null,
      priority: t.priority === 'high' ? 'high' : 'normal',
      domain: ['d_health', 'd_growth', 'd_career', 'd_life'].includes(t.domain) ? t.domain : 'd_life',
      planType: t.planType || null
    }));
    const reminders = (json.reminders || []).map(r => ({
      id: 'r' + Math.random().toString(36).slice(2, 7),
      text: r.text || '', at: r.at || null, repeat: r.repeat || null, domain: 'd_life'
    }));
    const links = (json.links || []).map(l => ({ from: l.from, to: l.to, kind: l.kind || 'plan-plan', relation: l.relation || '' }));
    const n = plans.length + todos.length + reminders.length;
    return { intent: n > 1 ? 'mixed' : 'single', plans, todos, reminders, links, summary: '端侧大模型完成分析。', engine: 'webllm' };
  }

  const LocalLLM = {
    backend: 'stub', // 'stub' | 'webllm'
    async analyze(text, opts) {
      opts = opts || {};
      const backend = opts.backend || this.backend;
      if (backend === 'webllm') {
        try { return await webllmAnalyze(text, opts); }
        catch (e) { console.warn('端侧大模型失败，回退 stub：', e); }
      }
      return stubAnalyze(text);
    },
    stubAnalyze,
    webllmAnalyze
  };

  /* ---------- 6. 端侧 Whisper 语音转写 ---------- */
  const WHISPER_MODEL = 'Xenova/whisper-tiny';
  let whisperPipe = null, whisperLoading = false;
  async function loadWhisper() {
    if (whisperPipe) return whisperPipe;
    if (whisperLoading) return null;
    whisperLoading = true;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
      const { pipeline } = mod;
      whisperPipe = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        device: 'wasm', dtype: 'q8', chunk_length_s: 30, stride_length_s: 5,
        progress_callback: (p) => { if (opts_onProg) opts_onProg(p); }
      });
      return whisperPipe;
    } catch (e) { whisperLoading = false; throw e; }
  }
  let opts_onProg = null;
  async function resampleTo16k(ab) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OC(1, Math.max(1, Math.ceil(ab.duration * 16000)), 16000);
    const s = off.createBufferSource(); s.buffer = ab; s.connect(off.destination); s.start();
    const r = await off.startRendering(); return r.getChannelData(0);
  }
  async function transcribe(blob, onProg) {
    opts_onProg = onProg || null;
    const arr = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const buf = await ac.decodeAudioData(arr.slice(0));
    const f32 = await resampleTo16k(buf);
    if (ac.close) ac.close();
    const pipe = await loadWhisper();
    const out = await pipe(f32, { sampling_rate: 16000, language: 'zh', task: 'transcribe', return_timestamps: false });
    return (out && out.text) || '';
  }

  /* ---------- 7. 示例语句（演示用） ---------- */
  const SAMPLES = [
    '明早8点提醒我吃药，然后这周把《活着》读完，顺便每天跑步30分钟减肥',
    '提醒我下午3点开会；本周学会用 React 写组件；每天背20个单词',
    '今晚8点给妈妈打电话，周末去超市买牛奶和鸡蛋，下个月开始每天早起跑步'
  ];

  /* ---------- 8. 共享液态玻璃主题 ---------- */
  const CSS = `
  :root{ --bg:#0b1118; --glass:rgba(20,32,44,.55); --glass2:rgba(16,28,40,.42);
    --teal:#5fe6d4; --reading:#6ea8ff; --fitness:#5fe6d4; --diet:#ffb86b; --custom:#b794f6;
    --txt:#e8eef5; --mut:#8aa0b4; --line:rgba(255,255,255,.08); --radius:18px; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:radial-gradient(1200px 700px at 70% -10%,#15212e 0%,var(--bg) 55%);
    color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft Yahei",sans-serif;
    -webkit-font-smoothing:antialiased;line-height:1.5}
  .wrap{max-width:760px;margin:0 auto;padding:22px 18px 60px}
  .glass{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);
    border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06)}
  .card{padding:16px 16px;margin:14px 0}
  h1{font-size:20px;margin:6px 0 2px}
  h2{font-size:15px;margin:0 0 10px;color:var(--teal);letter-spacing:.04em}
  .muted{color:var(--mut);font-size:13px}
  .pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:999px;
    background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--mut);margin:2px 4px 2px 0}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .field{width:100%;background:var(--glass2);border:1px solid var(--line);border-radius:14px;color:var(--txt);
    padding:12px 14px;font-size:15px;outline:none;resize:vertical;min-height:64px;font-family:inherit}
  .field:focus{border-color:rgba(95,230,212,.5)}
  .btn{appearance:none;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--txt);
    padding:10px 16px;border-radius:12px;font-size:14px;cursor:pointer;transition:transform .12s,background .2s}
  .btn:hover{background:rgba(255,255,255,.12)}
  .btn:active{transform:scale(.96)}
  .btn.primary{background:linear-gradient(135deg,rgba(95,230,212,.9),rgba(95,230,212,.6));color:#06222a;border:none;font-weight:600}
  .btn.ghost{background:transparent}
  .chip{font-size:12px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line);cursor:pointer}
  .chip:hover{background:rgba(95,230,212,.18)}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
  .item{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:8px 0;background:var(--glass2);position:relative}
  .item .ttl{font-weight:600;margin-bottom:4px}
  .badge-high{position:absolute;top:10px;right:12px;font-size:10px;color:#ff8e8e;border:1px solid rgba(255,142,142,.4);padding:1px 6px;border-radius:999px}
  .link{font-size:12px;color:var(--mut);margin:4px 0 0 14px}
  .link::before{content:"🔗 "}
  .progress{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px}
  .progress > i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),#7fe9ff);transition:width .2s}
  .toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--mut);cursor:pointer}
  .switch{width:40px;height:22px;border-radius:999px;background:rgba(255,255,255,.12);position:relative;transition:background .2s}
  .switch.on{background:var(--teal)}
  .switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}
  .switch.on::after{left:20px}
  .preload-card{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;margin:8px 0;border:1px solid var(--line);border-radius:14px;background:var(--glass2)}
  .tag{font-size:11px;padding:2px 8px;border-radius:999px}
  .tag.ok{background:rgba(95,230,212,.18);color:var(--teal)}
  .tag.no{background:rgba(255,255,255,.06);color:var(--mut)}
  .voice-btn{width:96px;height:96px;border-radius:50%;border:1px solid rgba(95,230,212,.5);
    background:radial-gradient(circle at 50% 35%,rgba(95,230,212,.35),rgba(16,28,40,.6));color:var(--txt);
    font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:10px auto;
    box-shadow:0 0 0 0 rgba(95,230,212,.5);transition:transform .12s,box-shadow .2s;user-select:none}
  .voice-btn:active,.voice-btn.rec{transform:scale(.94);box-shadow:0 0 0 10px rgba(95,230,212,.18)}
  .center{text-align:center}
  .summary{font-size:14px;padding:10px 12px;border-radius:12px;background:rgba(95,230,212,.1);border:1px solid rgba(95,230,212,.3);margin:8px 0}
  `;
  function injectStyles() {
    if (document.getElementById('__ai_core_css__')) return;
    const s = document.createElement('style'); s.id = '__ai_core_css__'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- 9. 暴露 ---------- */
  const AICore = {
    MODELS, ModelPreloader, LocalLLM, TYPES, DOMAINS,
    domainName, domainColor,
    splitClauses, detectTime, detectFreq, detectPlanType, detectDomain, detectTodoVerb,
    stubAnalyze, webllmAnalyze, transcribe, loadWhisper,
    SAMPLES, injectStyles,
    // 渲染辅助：把分析结果渲染成卡片（focus 可为 'all'|'plans'|'todos'|'reminders'）
    renderResult(el, res, focus) {
      if (!el) return;
      focus = focus || 'all';
      let h = '<div class="summary">' + (res.summary || '') +
        ' <span class="pill">引擎：' + (res.engine === 'webllm' ? '端侧大模型' : '本机启发式') + '</span></div>';
      if ((focus === 'all' || focus === 'plans') && res.plans && res.plans.length) {
        h += '<h2>📌 计划 Plans</h2>';
        res.plans.forEach(p => {
          h += '<div class="item"><span class="dot" style="background:' + (TYPES[p.type] ? TYPES[p.type].color : '#8aa0b4') + '"></span>' +
            '<span class="ttl">' + esc(p.title) + ' <span class="pill" style="color:' + (TYPES[p.type] ? TYPES[p.type].color : '#8aa0b4') + '">' +
            (TYPES[p.type] ? TYPES[p.type].icon + TYPES[p.type].name : '') + '</span> ' +
            '<span class="pill">' + domainName(p.domain) + '</span>' +
            (p.frequency && p.frequency.label ? '<span class="pill">⏱ ' + p.frequency.label + '</span>' : '') +
            (p.deadline ? '<span class="pill">🎯 ' + esc(p.deadline) + '</span>' : '') + '</span>';
          (p.tasks || []).forEach(t => { h += '<div class="muted" style="margin:2px 0 0 14px">• ' + esc(t.text) + '</div>'; });
          h += '</div>';
        });
      }
      if ((focus === 'all' || focus === 'todos') && res.todos && res.todos.length) {
        h += '<h2>✅ 待办 Todos</h2>';
        res.todos.forEach(t => {
          h += '<div class="item">' + (t.priority === 'high' ? '<span class="badge-high">紧急</span>' : '') +
            '<span class="ttl">' + esc(t.text) + '</span>' +
            (t.due ? '<span class="pill">⏰ ' + esc(t.due) + '</span>' : '') +
            '<span class="pill">' + domainName(t.domain) + '</span></div>';
        });
      }
      if ((focus === 'all' || focus === 'reminders') && res.reminders && res.reminders.length) {
        h += '<h2>🔔 提醒 Reminders</h2>';
        res.reminders.forEach(r => {
          h += '<div class="item"><span class="ttl">' + esc(r.text) + '</span>' +
            (r.at ? '<span class="pill">⏰ ' + esc(r.at) + '</span>' : '') +
            (r.repeat ? '<span class="pill">🔁 ' + esc(r.repeat) + '</span>' : '') + '</div>';
        });
      }
      if (focus === 'all' && res.links && res.links.length) {
        h += '<h2>🔗 关联 Links</h2>';
        const label = (id) => {
          const all = [].concat(res.plans || [], res.todos || [], res.reminders || []);
          const x = all.find(z => z.id === id); if (!x) return id;
          return x.title || x.text;
        };
        res.links.forEach(l => { h += '<div class="link">' + esc(label(l.from)) + ' ↔ ' + esc(label(l.to)) + '（' + esc(l.relation || '') + '）</div>'; });
      }
      if (!res.plans.length && !res.todos.length && !res.reminders.length)
        h += '<p class="muted">没有分析出可归类的实体，换句话试试。</p>';
      el.innerHTML = h;
    }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  if (typeof module !== 'undefined' && module.exports) module.exports = AICore;
  if (typeof window !== 'undefined') window.AICore = AICore;
  if (typeof globalThis !== 'undefined') globalThis.AICore = AICore;
  root.AICore = AICore;
})(typeof window !== 'undefined' ? window : globalThis);
