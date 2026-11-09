import {computed,onMounted,onUnmounted,reactive,ref,watch,inject,type InjectionKey} from 'vue';import {effective,isWithin,toggle,normalize} from '../domain/selection';import type {Root,Override,Entry,RuleSettings,ZipPlan,Progress,PreviewProgress} from '../domain/model';
import {readSettings,writeSettings,sameOverrides,type Preset} from '../domain/preset-storage';

export function useZipBuilder(){





type Node=Entry&{expanded:boolean;loaded:boolean;busy:boolean;children:Node[];error:string};

type Dialog='rules'|'save'|'delete'|'overwrite'|'clear'|null;

const nodes=ref<Node[]>([]),overrides=ref<Override[]>([]);
const presets=ref<Preset[]>([]),currentPreset=ref(''),lastUsed=ref<Record<string,string>>({});
const focusedRoot=ref(''),favorites=ref<string[]>([]);
const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
const filename=ref(''),filenameEdited=ref(false),outputDirectory=ref(''),outputPath=ref('');
const rules=reactive<RuleSettings>({enabled:true,names:['.git','node_modules','__pycache__','.venv','.cache']});
const newRule=ref(''),dialog=ref<Dialog>(null),presetName=ref('');
const menu=ref<'presets'|'favorites'|'more'|null>(null),message=ref(''),error=ref('');
const favoriteSearch=ref(''),presetActions=ref(''),targetPreset=ref('');
const busy=ref(false),progress=ref<Progress|null>(null),destination=ref(''),overwriteConfirmed=ref(false),saveAsNew=ref(false);
const api=window.zipBuilderApi;
// Only a completed scan is a final result. A pending scan reports a lower bound.
const preview=ref<PreviewProgress|null>(null);
const previewState=ref<'idle'|'scanning'|'ready'|'error'>('idle');
const previewError=ref('');
const previewCache=new Map<string,{value:PreviewProgress;at:number}>();
let previewTimer:ReturnType<typeof setTimeout>|undefined;
let previewGeneration=0;
const PREVIEW_CACHE_MS=20_000;

// Hide the native plugin sub-input using the documented host API; don't touch host DOM.
function hideHostInput(){try{void Promise.resolve(window.ztools?.removeSubInput?.()).catch(()=>{});}catch{}}
const roots=computed<Root[]>(()=>nodes.value.map(n=>({path:n.path,label:n.name})));
const working=computed(()=>busy.value||nodes.value.some(n=>n.busy));
const activePreset=computed(()=>availablePresets.value.find(p=>p.id===currentPreset.value));
const focusNode=computed(()=>nodes.value.find(n=>normalize(n.path)===normalize(focusedRoot.value)));
const availablePresets=computed(()=>focusedRoot.value?presets.value.filter(p=>p.roots.length===1&&normalize(p.roots[0].path)===normalize(focusedRoot.value)).sort((a,b)=>collator.compare(a.name,b.name)):[]);
const sortedFavorites=computed(()=>[...favorites.value].sort((a,b)=>collator.compare(labelFor(a),labelFor(b))||collator.compare(a,b)));
const filteredFavorites=computed(()=>sortedFavorites.value.filter(path=>(labelFor(path)+' '+path).toLocaleLowerCase().includes(favoriteSearch.value.trim().toLocaleLowerCase())));
const favoriteCurrent=computed(()=>!!focusedRoot.value&&favorites.value.some(p=>normalize(p)===normalize(focusedRoot.value)));
const currentKey=computed(()=>focusedRoot.value?normalize(focusedRoot.value):'');
function joinOutput(dir:string,name:string){return dir?dir.replace(/[\\/]+$/,'')+(dir.includes('\\')?'\\':'/')+name:name;}
function syncOutputPath(){outputPath.value=joinOutput(outputDirectory.value,filename.value||defaultZipName());}
function updateOutputPath(value:string){outputPath.value=value;const index=Math.max(value.lastIndexOf('/'),value.lastIndexOf('\\'));filename.value=value.slice(index+1);filenameEdited.value=true;}
const defaultZipName=()=>{const names=nodes.value.map(n=>n.name);return (names.length===0?'archive':names.length===1?names[0]:names.length<=2?names.join('+'):names[0]+'+'+names.length+'folders')+'.zip';};
function presetId(){return 'preset-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);}
function persist(){
  writeSettings(localStorage,{presets:presets.value,favorites:favorites.value,lastUsed:lastUsed.value,
    rules:{enabled:rules.enabled,names:[...rules.names]},outputDirectory:outputDirectory.value});
}
function initialize(){
  const saved=readSettings(localStorage,presetId);
  presets.value=saved.presets;
  lastUsed.value=saved.lastUsed;
  favorites.value=saved.favorites;
  rules.enabled=saved.rules.enabled;
  rules.names=saved.rules.names;
  outputDirectory.value=saved.outputDirectory;
  filename.value=defaultZipName();
  syncOutputPath();
}

function node(entry:Entry):Node{return {...entry,expanded:false,loaded:false,busy:false,children:[],error:''};}
function labelFor(location:string){const raw=location.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||location;return /^[A-Za-z]:$/.test(raw)?'Drive-'+raw[0].toUpperCase():raw;}
function rootFor(target:string){return roots.value.find(r=>isWithin(target,r.path));}
function chosen(target:string){const root=rootFor(target);return !!root&&effective(target,root.path,overrides.value,rules);}
function partSelected(n:Node):boolean{return n.directory&&(overrides.value.some(o=>isWithin(o.path,n.path)&&normalize(o.path)!==normalize(n.path)&&o.include!==chosen(n.path))||n.children.some(c=>chosen(c.path)!==chosen(n.path)||partSelected(c)));}
function checkState(n:Node):'on'|'off'|'mixed'{return partSelected(n)?'mixed':chosen(n.path)?'on':'off';}
// Unsaved state is derived from the saved snapshot, never manually toggled.
const dirty=computed(()=>modifiedForFocus());
function setChecked(n:Node){if(working.value)return;overrides.value=toggle(n.path,checkState(n)!=='on',overrides.value);}
function fileKind(n:Node):'folder'|'code'|'document'|'config'|'archive'|'other'{
  if(n.directory)return 'folder';
  const ext=n.name.slice(n.name.lastIndexOf('.')+1).toLowerCase();
  if(['ts','tsx','js','jsx','mjs','cjs','py','go','rs','java','c','cpp','h','css','html','vue','sh','ps1','bat'].includes(ext))return 'code';
  if(['md','txt','pdf','doc','docx','rtf','epub'].includes(ext))return 'document';
  if(['json','jsonc','yaml','yml','toml','ini','xml','env','lock'].includes(ext)||['.gitignore','.editorconfig','dockerfile'].includes(n.name.toLowerCase()))return 'config';
  if(['zip','7z','rar','tar','gz','bz2','xz'].includes(ext))return 'archive';
  return 'other';
}
function fileIcon(n:Node){const kind=fileKind(n);return ({folder:'folder-open',code:'file-code',document:'file-text',config:'file-cog',archive:'file-archive',other:'file'} as const)[kind];}

function updateFilename(value:string){filename.value=value;filenameEdited.value=true;syncOutputPath();}
function updateAutoFilename(){if(!filenameEdited.value){filename.value=defaultZipName();syncOutputPath();}}
function snapshot(id:string,name:string):Preset{const focus=focusNode.value;if(!focus)throw Error('请先选择一个来源文件夹');return {id,name,roots:[{path:focus.path,label:focus.name}],overrides:overrides.value.filter(o=>isWithin(o.path,focus.path)).map(o=>({...o})),rules:{enabled:rules.enabled,names:[...rules.names]},filename:filename.value};}
function scopedOverrides(path:string){return overrides.value.filter(o=>isWithin(o.path,path));}

function modifiedForFocus(){
  const p=activePreset.value;
  if(!p)return false;
  return !sameOverrides(scopedOverrides(focusedRoot.value),p.overrides)
    ||(nodes.value.length===1 && filename.value!==(p.filename||defaultZipName()));
}

function focusSource(path:string,restore=false){
  const selected=nodes.value.find(n=>normalize(n.path)===normalize(path));
  focusedRoot.value=selected?.path||'';currentPreset.value='';
  if(!selected)return;
  const matches=availablePresets.value;
  const p=matches.find(item=>item.id===lastUsed.value[currentKey.value])||matches[0];
  if(p){currentPreset.value=p.id;if(restore)applyPreset(p);}
}
function applyPreset(p:Preset){
  if(!focusNode.value||p.roots.length!==1||normalize(p.roots[0].path)!==normalize(focusedRoot.value))return;
  overrides.value=[...overrides.value.filter(o=>!isWithin(o.path,focusedRoot.value)),...p.overrides.map(o=>({...o}))];
  // Auto-exclusion is global and deliberately not restored by a source-scoped preset.
  if(nodes.value.length===1){filename.value=p.filename||defaultZipName();filenameEdited.value=!!p.filename&&p.filename!==defaultZipName();syncOutputPath();}
  currentPreset.value=p.id;lastUsed.value[currentKey.value]=p.id;persist();error.value='';
}
function autoMatch(previous?:{roots:Root[];overrides:Override[]},preferred?:string){
  if(!nodes.value.length){focusedRoot.value='';currentPreset.value='';overrides.value=[];updateAutoFilename();return;}
  const surviving=(previous?.overrides||[]).filter(o=>roots.value.some(r=>isWithin(o.path,r.path)));
  const added=nodes.value.filter(n=>!(previous?.roots||[]).some(r=>normalize(r.path)===normalize(n.path)));
  const restored=added.flatMap(n=>{
    const matches=presets.value.filter(p=>p.roots.length===1&&normalize(p.roots[0].path)===normalize(n.path));
    const p=matches.find(x=>x.id===lastUsed.value[normalize(n.path)])||matches[0];
    return (p?.overrides||[]).map(o=>({...o}));
  });
  overrides.value=[...surviving,...restored];
  updateAutoFilename();
  const preferredNode=nodes.value.find(n=>normalize(n.path)===normalize(preferred||''))||
    nodes.value.find(n=>normalize(n.path)===normalize(focusedRoot.value))||added[0]||nodes.value[0];
  focusSource(preferredNode.path,added.some(n=>normalize(n.path)===normalize(preferredNode.path)));
}
function addFavorite(){if(!focusedRoot.value)return;if(!favoriteCurrent.value)favorites.value.push(focusedRoot.value);menu.value=null;persist();}
function removeFavorite(path:string){favorites.value=favorites.value.filter(p=>normalize(p)!==normalize(path));persist();}
async function chooseFavorite(path:string){
  if(working.value)return;menu.value=null;error.value='';
  try{await api.readDirectory(path);}catch(e){error.value=`收藏路径不可用：${path}（${String(e)}）`;return;}
  const previous={roots:roots.value.map(r=>({...r})),overrides:overrides.value.map(o=>({...o}))};
  const existing=nodes.value.find(n=>normalize(n.path)===normalize(path));
  if(!existing){
    const replacement=node({path,name:labelFor(path),directory:true});
    if(nodes.value.length===1)nodes.value=[replacement];else nodes.value.push(replacement);
  }
  autoMatch(previous,path);
}
async function chooseSources(mode:'add'|'replace',target?:Node){
  if(working.value)return;
  error.value='';
  const previous={roots:roots.value.map(r=>({...r})),overrides:overrides.value.map(o=>({...o}))};
  try{
    const selected=mode==='replace'?await api.selectFolder():await api.selectFolders();
    if(!selected.length)return;
    if(mode==='replace'){
      const location=selected[0];
      const replacement=node({path:location,name:labelFor(location),directory:true});
      const index=target?nodes.value.findIndex(n=>n.path===target.path):nodes.value.length===1?0:-1;
      if(index<0){error.value='请使用来源目录右侧的菜单选择要替换的文件夹。';return;}
      if(nodes.value.some((n,i)=>i!==index&&normalize(n.path)===normalize(location))){error.value='该目录已经在来源列表中';return;}
      nodes.value.splice(index,1,replacement);
    }else{
      for(const location of selected){if(nodes.value.some(n=>normalize(n.path)===normalize(location)))continue;nodes.value.push(node({path:location,name:labelFor(location),directory:true}));}
    }
    const preferred=selected.find(location=>!(previous.roots.some(r=>normalize(r.path)===normalize(location))))||selected[0];
    autoMatch(previous,preferred);
  }catch(e){error.value=String(e);}
}
function removeRoot(n:Node){if(working.value)return;const previous={roots:roots.value.map(r=>({...r})),overrides:overrides.value.map(o=>({...o}))};nodes.value=nodes.value.filter(x=>x!==n);autoMatch(previous);}
async function expand(n:Node){
  if(!n.directory)return;
  if(n.expanded){n.expanded=false;return;}
  n.expanded=true;if(n.loaded||n.busy)return;
  n.busy=true;n.error='';
  try{n.children=(await api.readDirectory(n.path)).map(node);n.loaded=true;}
  catch(e){n.error=String(e);n.expanded=false;error.value=`读取失败：${n.path}：${String(e)}`;}
  finally{n.busy=false;}
}
const visible=computed(()=>{const out:{node:Node;depth:number}[]=[];const visit=(n:Node,depth:number)=>{out.push({node:n,depth});if(n.expanded)for(const child of n.children)visit(child,depth+1);};for(const n of nodes.value)visit(n,0);return out;});
function addRule(){const name=newRule.value.trim();if(!name)return;if(name.includes('/')||name.includes('\\')||name==='.'||name==='..'){error.value='排除规则只能是文件夹或文件名称';return;}if(!rules.names.some(n=>n.toLowerCase()===name.toLowerCase()))rules.names.push(name);newRule.value='';persist();}
function deleteRule(index:number){rules.names.splice(index,1);persist();}
function openSave(asNew=false){if(!focusNode.value)return;menu.value=null;saveAsNew.value=asNew;presetName.value=asNew?'':activePreset.value?.name||'';dialog.value='save';}
function savePreset(){
  const name=presetName.value.trim();if(!name||!focusNode.value)return;
  let id=saveAsNew.value?'':currentPreset.value;
  if(!id){id=presetId();presets.value.push(snapshot(id,name));}
  else {const index=presets.value.findIndex(p=>p.id===id);if(index>=0)presets.value.splice(index,1,snapshot(id,name));else presets.value.push(snapshot(id,name));}
  currentPreset.value=id;lastUsed.value[currentKey.value]=id;saveAsNew.value=false;persist();dialog.value=null;message.value=`方案「${name}」已保存`;
}
function createPresetInline(rawName:string):string|null{
  if(working.value||!focusNode.value)return '请先选择文件夹';
  const name=rawName.trim();
  if(!name)return '方案名称不能为空';
  if(name.length>80)return '方案名称不能超过 80 个字符';
  if(availablePresets.value.some(item=>item.name===name))return '方案名称已存在';
  const id=presetId();
  presets.value.push(snapshot(id,name));
  currentPreset.value=id;
  lastUsed.value[currentKey.value]=id;
  persist();
  message.value=`方案「${name}」已保存`;
  return null;
}
function selectPreset(p:Preset){menu.value=null;presetActions.value='';if(working.value)return;applyPreset(p);}
function renamePresetInline(p:Preset,rawName:string):string|null{
  const name=rawName.trim();
  if(!name)return '方案名称不能为空';
  if(name.length>80)return '方案名称不能超过 80 个字符';
  if(!availablePresets.value.some(item=>item.id===p.id))return '当前目录中没有该方案';
  if(availablePresets.value.some(other=>other.id!==p.id&&other.name===name))return '方案名称已存在';
  if(p.name!==name){p.name=name;persist();}
  return null;
}
function askDeletePreset(p:Preset){targetPreset.value=p.id;dialog.value='delete';menu.value=null;presetActions.value='';}
const targetPresetData=computed(()=>presets.value.find(p=>p.id===targetPreset.value));
function removePreset(){const id=targetPreset.value;if(!id)return;presets.value=presets.value.filter(p=>p.id!==id);Object.keys(lastUsed.value).forEach(key=>{if(lastUsed.value[key]===id)delete lastUsed.value[key];});if(currentPreset.value===id){currentPreset.value='';}persist();dialog.value=null;targetPreset.value='';}
function resetSelection(){if(!focusedRoot.value)return;overrides.value=overrides.value.filter(o=>!isWithin(o.path,focusedRoot.value));menu.value=null;}
// Each source has its own active saved preset; an uncommitted change in any source needs confirmation.
const hasUnsavedPresetChanges=computed(()=>nodes.value.some(source=>{
  const path=normalize(source.path);
  const id=path===normalize(focusedRoot.value)?currentPreset.value:lastUsed.value[path];
  const saved=presets.value.find(p=>p.id===id&&p.roots.length===1&&normalize(p.roots[0].path)===path);
  if(!saved)return false;
  return !sameOverrides(scopedOverrides(source.path),saved.overrides)
    ||(nodes.value.length===1&&path===normalize(focusedRoot.value)&&filename.value!==(saved.filename||defaultZipName()));
}));
function clearSources(){
  if(working.value||!nodes.value.length)return;
  menu.value=null;
  if(hasUnsavedPresetChanges.value){dialog.value='clear';return;}
  confirmClearSources();
}
function confirmClearSources(){
  if(working.value)return;
  // Ignore pending preview callbacks and abort the scan before replacing its inputs.
  previewGeneration++;
  if(previewTimer){clearTimeout(previewTimer);previewTimer=undefined;}
  api.cancelPreview();
  previewCache.clear();
  preview.value=null;previewState.value='idle';previewError.value='';
  nodes.value=[];overrides.value=[];focusedRoot.value='';currentPreset.value='';
  filenameEdited.value=false;filename.value=defaultZipName();syncOutputPath();
  menu.value=null;dialog.value=null;destination.value='';overwriteConfirmed.value=false;
  error.value='';message.value='';progress.value=null;
}

async function chooseOutputDirectory(){if(working.value)return;menu.value=null;try{const picked=await api.selectFolder();if(picked[0]){outputDirectory.value=picked[0];syncOutputPath();persist();}}catch(e){error.value=String(e);}}
function zipFilename(){let name=filename.value.trim();if(!name)name=defaultZipName();if(!name.toLowerCase().endsWith('.zip'))name+='.zip';if(/[\\/:*?"<>|]/.test(name)||name==='.'||name==='..')throw Error('ZIP 文件名包含 Windows 不允许的字符');return name;}
async function archive(){
  if(working.value)return;
  error.value='';if(!nodes.value.length){error.value='请先添加来源文件夹';return;}
  try{
    const raw=outputPath.value.trim();
    const last=Math.max(raw.lastIndexOf('/'),raw.lastIndexOf('\\'));
    let directory=last>=0?raw.slice(0,last):outputDirectory.value;
    const name=last>=0?raw.slice(last+1):raw;
    if(!directory){const picked=await api.selectFolder();if(!picked[0])return;directory=picked[0];outputDirectory.value=directory;persist();}
    filename.value=name;destination.value=await api.resolveOutput(directory,zipFilename());
    if(await api.outputExists(destination.value)){overwriteConfirmed.value=false;dialog.value='overwrite';return;}
    await startArchive();
  }catch(e){error.value=String(e);}
}
async function startArchive(){
  dialog.value=null;
  const plan:ZipPlan={roots:roots.value,overrides:overrides.value.map(o=>({...o})),rules:{enabled:rules.enabled,names:[...rules.names]},output:destination.value,overwrite:overwriteConfirmed.value};
  busy.value=true;progress.value={phase:'scanning',done:0,files:0,bytes:0,totalBytes:0,name:''};message.value='正在扫描选中的文件…';
  try{const result=await api.run(plan,p=>{progress.value=p;});message.value=`已生成：${result.output}（${result.files} 个文件）`;}
  catch(e){error.value=String(e);message.value='打包未完成';}
  finally{busy.value=false;progress.value=null;}
}
function confirmOverwrite(){overwriteConfirmed.value=true;void startArchive();}
function cancel(){api.cancel();message.value='正在取消压缩…';}
// Preview uses the same planner as ZIP creation: no separate, divergent selection logic.
const selectionSignature=computed(()=>JSON.stringify({roots:roots.value,overrides:overrides.value,rules:{enabled:rules.enabled,names:[...rules.names]},output:outputPath.value}));
function schedulePreview(){
  const token=++previewGeneration;
  if(previewTimer)clearTimeout(previewTimer);
  api.cancelPreview();
  previewError.value='';
  if(!nodes.value.length){preview.value=null;previewState.value='idle';return;}
  if(busy.value){previewState.value=preview.value?.complete?'ready':'idle';return;}
  const key=selectionSignature.value;
  const cached=previewCache.get(key);
  if(cached&&Date.now()-cached.at<PREVIEW_CACHE_MS){preview.value=cached.value;previewState.value='ready';return;}
  preview.value={files:0,bytes:0,complete:false};previewState.value='scanning';
  previewTimer=setTimeout(()=>{
    const plan:ZipPlan={roots:roots.value.map(x=>({...x})),overrides:overrides.value.map(x=>({...x})),rules:{enabled:rules.enabled,names:[...rules.names]},output:outputPath.value};
    void api.preview(plan,p=>{if(token===previewGeneration&&!busy.value){preview.value=p;previewState.value=p.complete?'ready':'scanning';}})
      .then(result=>{if(token!==previewGeneration||busy.value)return;preview.value=result;previewState.value='ready';previewCache.set(key,{value:result,at:Date.now()});if(previewCache.size>12)previewCache.delete(previewCache.keys().next().value!);})
      .catch(e=>{if(token!==previewGeneration||busy.value)return;const reason=String(e);if(/取消|abort/i.test(reason))return;previewState.value='error';previewError.value=reason;});
  },300);
}
watch([selectionSignature,busy],schedulePreview);
const percentage=computed(()=>!progress.value||progress.value.phase!=='writing'||!progress.value.totalBytes?0:Math.min(100,Math.round(progress.value.bytes/progress.value.totalBytes*100)));
function formatSize(bytes:number){if(bytes<1024)return bytes+' B';if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';if(bytes<1073741824)return (bytes/1048576).toFixed(1)+' MB';return (bytes/1073741824).toFixed(2)+' GB';}
function onKey(e:KeyboardEvent){if(e.key==='Escape'){if(dialog.value){dialog.value=null;e.preventDefault();}else if(presetActions.value){presetActions.value='';e.preventDefault();}else if(menu.value){menu.value=null;e.preventDefault();}return;}if(e.key==='Enter'&&dialog.value==='save')savePreset();}
function outsideMenu(e:MouseEvent){if(menu.value&&!(e.target as Element).closest('.menu-anchor')){menu.value=null;presetActions.value='';}}
function menuKeyboard(e:KeyboardEvent){if((e.target as HTMLElement).matches('input'))return;if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;const host=(e.currentTarget as HTMLElement).closest('.menu-anchor');const entries=Array.from(host?.querySelectorAll<HTMLButtonElement>('.popup-menu button:not(:disabled)')||[]);if(!entries.length)return;const index=entries.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==='ArrowDown'?(index+1)%entries.length:(index<=0?entries.length-1:index-1);entries[next].focus();e.preventDefault();}
function toggleMenu(which:'presets'|'favorites'|'more'){menu.value=menu.value===which?null:which;presetActions.value='';if(which==='favorites')favoriteSearch.value='';}
onMounted(()=>{initialize();hideHostInput();window.ztools?.onPluginEnter?.(()=>hideHostInput());window.addEventListener('keydown',onKey);document.addEventListener('pointerdown',outsideMenu);});
onUnmounted(()=>{if(previewTimer)clearTimeout(previewTimer);previewGeneration++;api.cancelPreview();window.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',outsideMenu);});

return {
nodes,overrides,presets,currentPreset,lastUsed,focusedRoot,favorites,filename,filenameEdited,outputDirectory,outputPath,rules,newRule,dialog,presetName,menu,message,error,favoriteSearch,presetActions,targetPreset,busy,progress,dirty,destination,overwriteConfirmed,saveAsNew,preview,previewState,previewError,roots,working,activePreset,focusNode,availablePresets,sortedFavorites,filteredFavorites,favoriteCurrent,currentKey,joinOutput,syncOutputPath,updateOutputPath,defaultZipName,presetId,persist,initialize,node,labelFor,rootFor,chosen,partSelected,checkState,setChecked,fileKind,fileIcon,updateFilename,updateAutoFilename,snapshot,scopedOverrides,modifiedForFocus,focusSource,applyPreset,autoMatch,addFavorite,removeFavorite,chooseFavorite,chooseSources,removeRoot,expand,visible,addRule,deleteRule,openSave,savePreset,selectPreset,createPresetInline,renamePresetInline,askDeletePreset,targetPresetData,removePreset,resetSelection,hasUnsavedPresetChanges,clearSources,confirmClearSources,chooseOutputDirectory,zipFilename,archive,startArchive,confirmOverwrite,cancel,selectionSignature,schedulePreview,percentage,formatSize,onKey,outsideMenu,menuKeyboard,toggleMenu,normalize
};
}

export type ZipBuilderContext=ReturnType<typeof useZipBuilder>;
export const zipBuilderKey:InjectionKey<ZipBuilderContext>=Symbol('zip-builder');
export function useZipBuilderContext():ZipBuilderContext {
  const context=inject(zipBuilderKey);
  if(!context)throw Error('ZIP Builder context missing');
  return context;
}
