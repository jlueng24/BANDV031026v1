const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const local = JSON.parse(fs.readFileSync(path.join(root, 'countries-local.json')));
const achievements = JSON.parse(fs.readFileSync(path.join(root, 'achievements.json'))).achievements;
const section = (start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)));

assert(local.countries.length >= 40);
assert.equal(new Set(local.countries.map(c => c[0])).size, local.countries.length);
assert(achievements.every(a => fs.existsSync(path.join(root, a.art))));
const survivalAchievements = achievements.filter(a=>a.series);
assert.equal(survivalAchievements.length,72,'tres retos, seis regiones y cuatro hitos');
assert.equal(new Set(survivalAchievements.map(a=>a.id)).size,72);
assert.equal(new Set(survivalAchievements.map(a=>a.series)).size,18);

async function checkLoader(offline) {
  const elements = { '#catalogStatus': { textContent:'' }, '#tile-daily': {disabled:true} };
  const buttons = ['all','Europe','Asia','Americas','Africa','Oceania'].map(theme => ({ dataset:{theme}, disabled:false }));
  const store = {};
  const ui = { selTheme:{textContent:''}, startGame:{disabled:true} };
  const world = Array.from({length:200}, (_, i) => ({
    cca2: (i < 40 ? 'a' : 'b') + String.fromCharCode(97 + i % 26),
    name:{common:`Country ${i}`}, translations:{spa:{common:`País ${i}`}},
    capital:[`Capital ${i}`], region:i < 40 ? 'Europe':'Asia'
  }));
  // The fixture needs 200 different two-letter identifiers.
  world.forEach((c, i) => { c.cca2 = String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26); });
  const ctx = vm.createContext({
    console:{warn(){}}, AbortController, setTimeout, clearTimeout,
    fetch: async url => {
      if (url === './countries-local.json') return {ok:true,json:async()=>local};
      if (offline) throw new Error('Sin red');
      return {ok:true,json:async()=>world};
    },
    toSpanishCapital: x=>x || '',
    lsGet: key=>store[key] || [], lsSet:(key, value)=>{store[key]=value},
    $: selector=>elements[selector], $$:()=>buttons, ui
  });
  vm.runInContext("let ALL=[]; let catalogScope='unavailable'; let currentTheme='all';\n" +
    section('/* ========= Carga de datos ========= */', '/* ========= UI refs ========= */'), ctx);
  await vm.runInContext('loadData()', ctx);
  const result = vm.runInContext('({count:ALL.length, scope:catalogScope, theme:currentTheme})', ctx);
  assert.equal(result.scope, offline ? 'europe':'world');
  assert.equal(result.count, offline ? local.countries.length:200);
  assert.equal(buttons[0].disabled, offline);
  assert.equal(ui.startGame.disabled, false);
  if (offline) assert.equal(result.theme, 'Europe');
}

function checkAchievements() {
  const store = {};
  const ctx = vm.createContext({
    LS:{achievements:'achievements',streak:'streak',scores:'scores',challenge:'challenge',
      albums:'albums',visited:'visited'}, unlockedThisRun:new Set(), Date,
    lsGet:(key, fallback)=>store[key] || fallback,
    lsSet:(key, val)=>{store[key]=structuredClone(val)},
    correct:true, q:{kind:'flag',item:{region:'Europe'}}, streak:1
  });
  const award = '{' + section('// Desbloqueos por región y tipo', "  if (currentMode!=='study') timesMs.push") + '}';
  vm.runInContext(section('function getAchievements()', '/* ========= Reto del día ========= */') + award, ctx);
  assert.deepEqual(Object.keys(store.achievements).sort(), ['primer_bandera_europa','primer_bandera_mundo']);
  vm.runInContext("correct=false; q={kind:'capital',item:{region:'Asia'}}", ctx);
  vm.runInContext(award, ctx);
  assert.equal(store.achievements.primer_capital_asia, undefined);
  store.scores = [{theme:'Europe'}];
  store.albums = {es:{region:'Europe',flag:{unlocked:true},capital:{unlocked:true}}};
  vm.runInContext('reconcileAchievements()', ctx);
  assert(store.achievements.progreso_primer_paso);
  assert(store.achievements.primer_capital_mundo);
  assert(store.achievements.primer_capital_europa);
}

function checkSurvivalMilestones(){
  const store={};
  const ctx=vm.createContext({
    Date,LS:{achievements:'achievements'},unlockedThisRun:new Set(),
    lsGet:(key,def)=>store[key] || def,
    lsSet:(key,value)=>{store[key]=structuredClone(value)},
    REGION_LABELS:{Europe:'Europa'},currentTheme:'Europe',survivalKind:'flags',
    roundLength:45,hits:11,misses:0
  });
  vm.runInContext(section('function getAchievements()', '/* ========= Reto del día ========= */'),ctx);
  vm.runInContext('unlockSurvivalMilestones()',ctx);
  assert.equal(Object.keys(store.achievements || {}).length,0);
  for (const [hits,stage] of [[12,25],[23,50],[34,75]]) {
    ctx.hits=hits;
    vm.runInContext('unlockSurvivalMilestones()',ctx);
    assert(store.achievements[`supervivencia_flags_europa_${stage}`]);
  }
  assert.equal(Object.keys(store.achievements).length,3);
  ctx.hits=45;ctx.misses=1;
  vm.runInContext('unlockSurvivalVictory()',ctx);
  assert.equal(store.achievements.supervivencia_flags_europa_100,undefined,'un fallo impide el título');
  ctx.misses=0;
  vm.runInContext('unlockSurvivalVictory()',ctx);
  assert(store.achievements.supervivencia_flags_europa_100);
  assert.equal(vm.runInContext('survivalVictoryTitle()',ctx),'Rey de Europa');
  ctx.currentTheme='all';ctx.survivalKind='mixed';
  assert.equal(vm.runInContext('survivalVictoryTitle()',ctx),'Leyenda del planeta');
}

function checkEuropeGame() {
  const text = () => ({textContent:''});
  const ui = {
    qTotal:text(), points:text(), hits:text(), misses:text(), qNumber:text(),
    hudPlayer:text(), hudMode:text(), hudTheme:text(), progressBar:{style:{width:''}}
  };
  const ctx = vm.createContext({
    ALL:local.countries.map(([code,nameES,capitalES])=>({code,nameES,capitalES,region:'Europe'})),
    currentTheme:'Europe', currentMode:'flags', survivalKind:'flags', currentLevel:'kids', playerName:'Prueba',
    MAX_Q:10, ui, LS:{last:'last',streak:'streak'},
    lsGet:()=>0,lsSet:()=>{},shuffle:a=>a,modeLabel:()=> 'Banderas',
    updatePauseButtons:()=>{},
    showScreen:()=>{},renderQuestion:()=>{},alert:()=>{throw Error('No hay suficientes países')}
  });
  vm.runInContext(section('function applyThemePool()', '/* ========= Logros Excel: helpers ========= */'), ctx);
  vm.runInContext('newGame()',ctx);
  const codes = vm.runInContext('order.map(q=>q.item.code)',ctx);
  assert.equal(codes.length,10);
  assert.equal(new Set(codes).size,10);

  for (const mode of ['capitals','mixed','study']) {
    vm.runInContext(`currentMode='${mode}'; newGame()`,ctx);
    const questions = vm.runInContext('order.map(q=>({code:q.item.code,kind:q.kind}))',ctx);
    assert.equal(questions.length,10,mode);
    assert.equal(new Set(questions.map(q=>q.code)).size,10,mode);
    if (mode==='capitals') assert(questions.every(q=>q.kind==='capital'));
  }

  for (const kind of ['flags','capitals','mixed']) {
    vm.runInContext(`currentMode='survival'; survivalKind='${kind}'; newGame()`,ctx);
    const questions = vm.runInContext('order.map(q=>`${q.item.code}:${q.kind}`)',ctx);
    const capitals = local.countries.filter(c=>c[2]).length;
    assert.equal(questions.length,kind==='flags' ? 45 : kind==='capitals' ? capitals : 45+capitals,kind);
    assert.equal(new Set(questions).size,questions.length,'cada tipo y país aparece una sola vez');
    assert.equal(ui.qTotal.textContent,`/${questions.length}`);
  }
  vm.runInContext("ALL[0].capitalES=''; survivalKind='mixed'; newGame()",ctx);
  const mixed = vm.runInContext('order.map(q=>`${q.item.code}:${q.kind}`)',ctx);
  assert.equal(mixed.length,89,'el Mixto incluye bandera aunque falte su capital');
  assert.equal(new Set(mixed).size,89);

  vm.runInContext("function endGame(reason){ globalThis.finished=reason }; " +
    section('function advanceProgress()', '/* ========= Supervivencia ========= */'),ctx);
  vm.runInContext('idx=roundLength-1; nextQuestion()',ctx);
  assert.equal(ctx.finished,'victory');

  vm.runInContext("currentMode='study'; newGame(); studyQueue.push(order[0]); idx=9; nextQuestion()",ctx);
  const reviewed = vm.runInContext('({length:order.length, last:order[10].item.code, first:order[0].item.code})',ctx);
  assert.equal(reviewed.length,11);
  assert.equal(reviewed.last,reviewed.first);
}

function checkDailyQuestion() {
  const day='2026-09-29';
  const saved={};
  const countries=local.countries.map(([code,nameES,capitalES])=>({code,nameES,capitalES}));
  const ctx=vm.createContext({
    ALL:countries, LS:{dailyQuestion:'dailyQuestion'}, todayStr:()=>day,
    lsGet:(key,fallback)=>saved[key] || fallback,
    lsSet:(key,val)=>{saved[key]=structuredClone(val)}
  });
  vm.runInContext(section('function hashSeed(', '/* ========= Tiempo y pausa ========= */'),ctx);
  const first=vm.runInContext('makeDailyQuestion()',ctx);
  vm.runInContext('ALL=ALL.slice(0,4).reverse()',ctx);
  const again=vm.runInContext('makeDailyQuestion()',ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(again)));
  assert.equal(vm.runInContext("obfuscateText('Bratislava', '2026-09-29')",ctx),
    vm.runInContext("obfuscateText('Bratislava', '2026-09-29')",ctx));

  const dateCtx=vm.createContext({Date:class {
    getFullYear(){return 2026} getMonth(){return 8} getDate(){return 30}
    toISOString(){return '2026-09-29T22:15:00.000Z'}
  }});
  vm.runInContext(section('const todayStr =', 'function isoWeekStringLocal'),dateCtx);
  assert.equal(vm.runInContext('todayStr()',dateCtx),'2026-09-30');
}

function checkPause(){
  const labels=[{textContent:''},{textContent:''}];
  const answers=[{disabled:false},{disabled:false}];
  const calls=[];
  const ctx=vm.createContext({
    paused:false,locked:false,currentMode:'survival',qAccumulatedMs:0,
    qActiveStartMs:Date.now()-1000,timeLeft:12,Date,
    $$:selector=>selector.includes('pauseBtn') ? labels : answers,
    stopSurvivalTimer:()=>calls.push('stop survival'),
    startSurvivalTimer:reset=>calls.push(`start survival ${reset}`),
    stopTimer:()=>calls.push('stop normal'),
    startTimer:()=>calls.push('start normal')
  });
  vm.runInContext(section('function updatePauseButtons()', '/* ========= Juego ========= */'),ctx);
  vm.runInContext('togglePause()',ctx);
  assert(answers.every(a=>a.disabled));
  assert.equal(labels[0].textContent,'▶ Reanudar');
  vm.runInContext('togglePause()',ctx);
  assert(answers.every(a=>!a.disabled));
  assert.equal(labels[0].textContent,'⏸ Pausa');
  assert.deepEqual(calls,['stop survival','start survival false']);
}

function checkSurvivalAnswerAndClock(){
  const intervals=new Map();
  const pending=new Map();
  let id=0;
  let ended='';
  const el=()=>({textContent:'',style:{width:''},classList:{add(){},remove(){}}});
  const label=el(),result=el();
  const button={
    dataset:{correct:'1',index:'0'},disabled:false,
    querySelector:selector=>selector==='.answer-label' ? label : result,
    setAttribute(name,value){this[name]=value}
  };
  const ui={
    whyFlag:el(),whyCap:el(),flagImg:el(),flagImgReveal:el(),countryReveal:el(),
    points:el(),hits:el(),misses:el(),qNumber:el(),timeLeft:el(),timeBar:el(),
    progressBar:el()
  };
  const country={code:'es',nameES:'España',region:'Europe'};
  const ctx=vm.createContext({
    Date,console,
    currentMode:'survival',currentLevel:'kids',LEVELS:{kids:{wrongPenalty:0}},
    order:Array.from({length:11},()=>({kind:'flag',item:country})),roundLength:11,idx:9,
    optionsPool:[country],locked:false,paused:false,timeLeft:0.1,
    score:90,hits:9,misses:0,streak:9,runStreak:9,bestRunStreak:9,missMap:{},timesMs:[],
    qAccumulatedMs:0,qActiveStartMs:Date.now()-1000,nextTimer:null,
    LS:{streak:'streak'},lsSet(){},
    ui, $:()=>el(), $$:()=>[button],flagUrl:()=>'',
    pickOptions:()=>[country,country,country,country],
    whyText:()=>'',markButtons(){},markFlagLearned(){},
    unlockAchievement(){},unlockSurvivalMilestones(){},fxCorrect(){},fxWrong(){},
    setInterval:cb=>{const key=++id;intervals.set(key,cb);return key},
    clearInterval:key=>intervals.delete(key),
    setTimeout:cb=>{const key=++id;pending.set(key,cb);return key},
    clearTimeout:key=>pending.delete(key),
    stopTimer(){},startTimer(){},endGame:reason=>{ended=reason;ctx.stopSurvivalTimer()}
  });
  vm.runInContext(section('const SURVIVAL_LEVELS =', '/* ========= Capitales ES (map) ========= */') +
    section('function renderQuestion()', 'function markButtons(') +
    section('function onSelect(', 'function handleTimeout(') +
    section('function advanceProgress()', '/* ========= Supervivencia ========= */') +
    section('let survivalInterval =', 'function endGame('),ctx);
  for(const [level,start] of [['kids',25],['adult',20],['master',15]]){
    ctx.currentLevel=level;
    vm.runInContext('idx=0; renderQuestion()',ctx);
    assert.equal(ctx.timeLeft,start,`inicio de Supervivencia ${level}`);
    assert.equal(ui.timeBar.style.width,'100%');
  }
  assert.equal(label.textContent,'España');
  assert.equal(button['aria-label'],'Opción A: España');
  ctx.currentLevel='kids';
  ctx.idx=9;
  ctx.timeLeft=0.1;
  assert.equal(intervals.size,1);
  vm.runInContext('onSelect({currentTarget:globalThis.testButton})',Object.assign(ctx,{testButton:button}));
  assert.equal(intervals.size,0,'el reloj debe detenerse al acertar');
  assert.equal(pending.size,1);
  assert.equal(ctx.hits,10);
  assert.equal(ctx.misses,0);
  assert.equal(ctx.bestRunStreak,10);
  assert.equal(ctx.timeLeft,0.1,'el reloj queda detenido al acertar');
  assert.equal(ended,'');
  const transition=[...pending.values()][0];
  pending.clear();transition();
  assert.equal(ctx.idx,10,'la partida continúa en la pregunta 11');
  assert.equal(ctx.order.length,11);
  assert.equal(intervals.size,1,'el reloj empieza en la pregunta nueva');
  assert.equal(ctx.timeLeft,25,'el reloj se reinicia por pregunta');

  ctx.timeLeft=0.1;
  [...intervals.values()][0]();
  assert.equal(ended,'timeout');
  assert.equal(ctx.misses,0,'agotarse el tiempo no es una respuesta fallada');
  assert.equal(intervals.size,0);
}

function checkAnswerPresentation(){
  const el=()=>({textContent:'',classList:{add(){},remove(){}}});
  const buttons=()=>Array.from({length:4},(_,index)=>{
    const label=el(),result=el();
    return {
      dataset:{index:String(index)},disabled:false,
      querySelector:selector=>selector==='.answer-label'?label:result,
      setAttribute(name,value){this[name]=value}
    };
  });
  const flagButtons=buttons(),capitalButtons=buttons();
  const countries=['Alemania','Francia','Italia','Bélgica'].map((name,i)=>({
    code:['de','fr','it','be'][i],nameES:name,capitalES:['Berlín','París','Roma','Bruselas'][i]
  }));
  const ui={
    whyFlag:el(),whyCap:el(),flagImg:el(),capitalName:el(),
    flagImgReveal:{classList:{add(){},remove(){}}},countryReveal:el(),qNumber:el()
  };
  const ctx=vm.createContext({
    console,ui,order:[{kind:'capital',item:countries[1]}],idx:0,
    currentMode:'capitals',optionsPool:countries,studyQueue:[],locked:false,
    $:()=>({classList:{add(){},remove(){}}}),
    $$:selector=>selector.includes('card-capital')?capitalButtons:flagButtons,
    pickOptions:()=>countries,flagUrl:code=>`flag-${code}`,
    startTimer(){},startSurvivalTimer(){},timeLeft:0
  });
  vm.runInContext(section('function renderQuestion()', 'function whyText('),ctx);
  vm.runInContext('renderQuestion()',ctx);
  assert.equal(ui.capitalName.textContent,'París');
  assert.equal(capitalButtons[1].querySelector('.answer-label').textContent,'Francia');
  assert.equal(capitalButtons[1]['aria-label'],'Opción B: Francia');
  vm.runInContext('markButtons(globalThis.capitalButtons, globalThis.capitalButtons[0])',Object.assign(ctx,{capitalButtons}));
  assert.equal(capitalButtons[0].dataset.feedback,'wrong');
  assert.equal(capitalButtons[0].querySelector('.answer-result').textContent,'✕');
  assert.equal(capitalButtons[1].dataset.feedback,'correct');
  assert.equal(capitalButtons[1].querySelector('.answer-result').textContent,'✓');
  assert(capitalButtons.every(button=>button.disabled));

  vm.runInContext('renderQuestion()',ctx);
  assert.equal(capitalButtons[0].dataset.feedback,undefined);
  assert.equal(capitalButtons[1].querySelector('.answer-result').textContent,'');
  vm.runInContext("order[0].kind='flag'; renderQuestion()",ctx);
  assert.equal(ui.flagImg.src,'flag-fr');
  assert.equal(flagButtons[1]['aria-label'],'Opción B: Francia');
}

function checkFinalResults(){
  const text=()=>({textContent:''});
  const hidden={value:true};
  const ui={
    finalPoints:text(),finalHits:text(),finalMisses:text(),finalQuestions:text(),
    finalBestStreak:text(),finalTitle:text(),finalMeta:text(),finalReason:text(),
    achievementsList:{},achievementsEmpty:{classList:{toggle:(name,value)=>{assert.equal(name,'hidden');hidden.value=value}}},
    openAlbumFromFinal:{classList:{add(){},remove(){}}}
  };
  let rendered=[];
  const ctx=vm.createContext({
    ui,score:100,hits:10,misses:0,idx:10,bestRunStreak:10,currentMode:'survival',
    currentTheme:'Europe',currentLevel:'kids',nextTimer:null,timesMs:[],
    unlockedThisRun:new Set(),albumUnlockedThisRun:new Set(),playerName:'Prueba',
    REGION_LABELS:{Europe:'Europa'},LEVELS:{kids:{label:'Niños'}},
    LS:{scores:'scores',visited:'visited'},
    stopTimer(){},stopSurvivalTimer(){},clearTimeout(){},
    gameModeLabel:()=> 'Supervivencia',
    unlockSurvivalVictory:()=>{ctx.victoryAwarded=true},survivalVictoryTitle:()=> 'Rey de Europa',
    unlockAchievement(){},lsGet:(_,fallback)=>fallback,lsSet(){},
    modeLabel:()=> 'Supervivencia',
    renderFinalAchievementChips:(_list,ids)=>{rendered=ids},
    showScreen:()=>{},recordGameToLeague:()=>{},updateGlobalStatsFromRun:()=>{}
  });
  vm.runInContext(section('function endGame(', '/* ========= Liga ========= */'),ctx);
  vm.runInContext("endGame('timeout')",ctx);
  assert.equal(ui.finalQuestions.textContent,11,'incluye la pregunta en la que se agotó el tiempo');
  assert.equal(ui.finalMisses.textContent,0);
  assert.equal(ui.finalBestStreak.textContent,10);
  assert.equal(ui.finalMeta.textContent,'Supervivencia · Europa · Niños');
  assert.match(ui.finalReason.textContent,/tiempo/);
  assert.equal(hidden.value,false,'debe explicar que no hay logros nuevos');

  ctx.hits=3;ctx.misses=1;ctx.idx=3;ctx.bestRunStreak=3;
  ctx.unlockedThisRun.add('rachas_3');
  vm.runInContext("endGame('wrong')",ctx);
  assert.equal(ui.finalQuestions.textContent,4);
  assert.equal(ui.finalBestStreak.textContent,3);
  assert.match(ui.finalReason.textContent,/incorrecta/);
  assert.equal(hidden.value,true);
  assert.equal(rendered.join(','),'rachas_3');

  ctx.hits=45;ctx.misses=0;ctx.idx=44;ctx.roundLength=45;
  vm.runInContext("endGame('victory')",ctx);
  assert.equal(ui.finalTitle.textContent,'🏆 Rey de Europa');
  assert.match(ui.finalReason.textContent,/45\/45/);
  assert.equal(ctx.victoryAwarded,true);
}

function checkAlbumCards(){
  const data=fs.readFileSync(path.join(root,'country-card-data.js'),'utf8');
  const cards={
    es:{code:'es',nameES:'España',region:'Europe',flag:{unlocked:true},capital:{unlocked:false,value:'Madrid'}},
    de:{code:'de',nameES:'Alemania',region:'Europe',flag:{unlocked:false},capital:{unlocked:true,value:'Berlín'}},
    fr:{code:'fr',nameES:'Francia',region:'Europe',flag:{unlocked:true},capital:{unlocked:true,value:'París'}}
  };
  const ui={albumSearch:{value:''},albumGrid:{innerHTML:'',querySelectorAll:()=>[]},albumEmpty:{classList:{toggle(){}}}};
  const ctx=vm.createContext({Intl,Date,ui,ALL:local.countries.map(([code,nameES,capitalES])=>({code,nameES,capitalES,region:'Europe'})),
    REGION_LABELS:{Europe:'Europa',Other:'Otras'},LS:{challenge:'challenge',dailyQuestion:'dailyQuestion'},
    getAlbum:()=>cards,lsGet:key=>key==='challenge'?{'2026-10-02':{correct:true,countryCode:'fr'}}:null,
    todayStr:()=> '2026-10-02',flagUrl:code=>`https://flagcdn.com/w320/${code}.png`,
    escapeCardText:s=>String(s),renderAlbumProgress(){}
  });
  vm.runInContext(data,ctx);
  vm.runInContext(section('/* ========= Cartas coleccionables ========= */','/* ========= Selección / respuesta ========= */'),ctx);
  vm.runInContext('renderAlbum()',ctx);
  assert.match(ui.albumGrid.innerHTML,/EU016\/045/,'España es la 16 de los 45 países del respaldo europeo');
  assert.match(ui.albumGrid.innerHTML,/data-code="de"[\s\S]*?album-scene is-locked[\s\S]*?Berlín/,'solo capital deja la silueta vacía');
  assert.match(ui.albumGrid.innerHTML,/class="album-card is-gold"[^>]*data-code="fr"[\s\S]*?album-daily-pin/,'las tres piezas dan borde dorado');
  assert.doesNotMatch(ui.albumGrid.innerHTML,/class="album-card is-gold"[^>]*data-code="es"/);
  assert.match(ui.albumGrid.innerHTML,/Euro · EUR/);
  assert.match(vm.runInContext("albumCurrency(null,'in')",ctx),/Rupia.*INR/i);
  assert.equal(vm.runInContext('COUNTRY_DIRECTORY.filter(c=>!COUNTRY_SHAPES[c.code]).length',ctx),0,'todos los países tienen silueta');
}

(async()=>{
  await checkLoader(true);
  await checkLoader(false);
  checkAchievements();
  checkSurvivalMilestones();
  checkEuropeGame();
  checkDailyQuestion();
  checkPause();
  checkSurvivalAnswerAndClock();
  checkAnswerPresentation();
  checkFinalResults();
  checkAlbumCards();
  console.log('OK: catálogos, modos, supervivencia, estudio, reto diario, logros, respuestas, álbum y resultado final');
})().catch(error => { console.error(error); process.exitCode = 1; });
