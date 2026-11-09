<script setup lang="ts">
import {provide} from 'vue';
import AppIcon from './components/AppIcon.vue';
import DirectoryTree from './components/DirectoryTree.vue';
import FavoriteSelector from './components/FavoriteSelector.vue';
import PresetSelector from './components/PresetSelector.vue';
import {useZipBuilder,zipBuilderKey} from './composables/useZipBuilder';
const vm=useZipBuilder();
provide(zipBuilderKey,vm);
const {nodes,working,currentPreset,dirty,menu,menuKeyboard,dialog,rules,chooseOutputDirectory,resetSelection,toggleMenu,chooseSources,clearSources,previewState,preview,previewError,formatSize,error,message,progress,outputPath,busy,updateOutputPath,cancel,archive,percentage,newRule,persist,addRule,deleteRule,targetPresetData,removePreset,destination,confirmOverwrite,confirmClearSources}=vm;
</script>
<template>
  <div class="app">
    <main>
      <div class="toolbar">
        <FavoriteSelector/>
        <PresetSelector/>
        <span v-if="currentPreset" class="muted preset-status">{{dirty?'未保存修改':'已保存'}}</span>
        <div class="grow"></div>
        <button class="secondary" :disabled="working" @click="chooseSources('add')"><AppIcon name="plus"/> 添加</button>
        <button class="secondary clear-sources" :disabled="working||!nodes.length" @click="clearSources"><AppIcon name="trash-2"/> 清空</button>
        <div class="menu-anchor" @keydown="menuKeyboard">
          <button class="secondary icon-btn" aria-label="更多设置" aria-haspopup="menu" :aria-expanded="menu==='more'" @click="toggleMenu('more')"><AppIcon name="settings"/></button>
          <div v-if="menu==='more'" class="popup-menu right-menu" role="menu">
            <button role="menuitem" @click="menu=null;dialog='rules'">排除规则 ({{rules.enabled?rules.names.length:'关'}})</button>
            <button role="menuitem" :disabled="working" @click="menu=null;chooseOutputDirectory()">默认保存位置</button>
            <button role="menuitem" :disabled="working" @click="resetSelection">重置勾选</button>
          </div>
        </div>
      </div>
      <DirectoryTree/>
      <footer>
        <div v-if="nodes.length" class="selection-summary" role="status" aria-live="off">
          <template v-if="previewState==='ready' && preview"><AppIcon name="file-text"/> 已选择 {{preview.files.toLocaleString()}} 个文件 · {{formatSize(preview.bytes)}} <span class="muted">（原始大小）</span></template>
          <template v-else-if="previewState==='scanning'"><AppIcon name="refresh-cw"/> 已统计 {{(preview?.files||0).toLocaleString()}} 个文件 · {{formatSize(preview?.bytes||0)}} <span class="muted">· 统计中…</span></template>
          <template v-else-if="previewState==='error'"><span class="muted" :title="previewError">大小统计失败；打包时会重新扫描</span></template>
          <template v-else><span class="muted">等待统计…</span></template>
        </div>
        <div v-if="error||message||progress" class="status" :class="{failure:!!error}" role="status">{{error||message}}</div>
        <div class="output-row">
          <input class="output-path" aria-label="完整 ZIP 输出路径" :value="outputPath" :disabled="busy" placeholder="完整 ZIP 输出路径，例如 E:\Downloads\project.zip" @input="updateOutputPath(($event.target as HTMLInputElement).value)"/>
          <button v-if="busy" class="secondary action" @click="cancel">取消压缩</button>
          <button v-else class="primary action" :disabled="!nodes.length" @click="archive">生成 ZIP</button>
        </div>
        <div v-if="progress" class="progress-info"><div class="progress-track"><div :style="{width:percentage+'%'}"></div></div><small>{{progress.phase==='scanning'?'正在扫描…':'正在压缩…'}} {{progress.done}} / {{progress.files}} 个文件 · {{formatSize(progress.bytes)}} / {{formatSize(progress.totalBytes)}} {{progress.name}}</small></div>
      </footer>
    </main>
    <div v-if="dialog" class="modal-backdrop" @click.self="dialog=null">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="dialog==='rules'?'排除规则':dialog==='clear'?'清空来源目录':'选择方案操作'">
        <template v-if="dialog==='rules'">
          <h2>自动排除规则</h2><p class="muted">按名称排除任意层级的文件或目录；手动勾选优先。</p>
          <label class="switch"><input v-model="rules.enabled" type="checkbox" @change="persist()"/> 启用自动排除</label>
          <div class="rule-list"><div v-for="(name,index) in rules.names" :key="name" class="rule-row"><span>{{name}}</span><button class="rule-delete" :aria-label="'删除 '+name" @click="deleteRule(index)"><AppIcon name="x"/></button></div></div>
          <div class="add-rule"><input v-model="newRule" placeholder="新增名称，例如 .next" @keydown.enter="addRule"/><button class="secondary" @click="addRule">添加</button></div>
        </template>
        <template v-else-if="dialog==='delete'"><h2>删除方案</h2><p>删除「{{targetPresetData?.name}}」？不会删除任何本地文件。</p></template>
        <template v-else-if="dialog==='overwrite'"><h2>文件已存在</h2><p>目标 ZIP 已存在。确认覆盖？</p><p class="path-note">{{destination}}</p></template>
        <template v-else-if="dialog==='clear'"><h2>清空来源目录？</h2><p>当前存在未保存的方案修改，清空后将丢失这些临时选择。</p><p class="muted">已保存方案、常用文件夹、排除规则和磁盘文件不会受到影响。</p></template>
        <div class="modal-actions"><button class="secondary" @click="dialog=null">{{dialog==='rules'?'完成':'取消'}}</button><button v-if="dialog==='delete'" class="danger" @click="removePreset">删除</button><button v-if="dialog==='overwrite'" class="danger" @click="confirmOverwrite">覆盖并打包</button><button v-if="dialog==='clear'" class="danger" @click="confirmClearSources">确认清空</button></div>
      </div>
    </div>
  </div>
</template>
