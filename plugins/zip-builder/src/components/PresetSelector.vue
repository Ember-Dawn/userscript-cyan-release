<script setup lang="ts">
import {ref,watch} from 'vue';
import AppIcon from './AppIcon.vue';
import {useZipBuilderContext} from '../composables/useZipBuilder';
import type {Preset} from '../domain/preset-storage';
const {menu,menuKeyboard,working,focusNode,availablePresets,currentPreset,selectPreset,createPresetInline,renamePresetInline,askDeletePreset,openSave,toggleMenu}=useZipBuilderContext();
const editingId=ref('');
const creating=ref(false);
const createName=ref('');
const createError=ref('');
const draftName=ref('');
// A template ref inside v-for becomes an array; a mounted directive targets the actual input.
const vSelectAll = {mounted(el: HTMLInputElement){el.focus();el.select();}};
const renameError=ref('');
function beginRename(p:Preset){
  creating.value=false;createError.value='';
  editingId.value=p.id;
  draftName.value=p.name;
  renameError.value='';
}
function cancelRename(){editingId.value='';draftName.value='';renameError.value='';}
function submitRename(p:Preset){
  if(working.value)return;
  const issue=renamePresetInline(p,draftName.value);
  if(issue){renameError.value=issue;return;}
  cancelRename();
}
function blurRename(p:Preset){
  if(editingId.value!==p.id)return;
  const issue=renamePresetInline(p,draftName.value);
  // Invalid values are not saved when focus leaves the input.
  if(issue){cancelRename();return;}
  cancelRename();
}
function beginCreate(){
  if(working.value)return;
  cancelRename();
  createName.value='';createError.value='';creating.value=true;
}
function cancelCreate(){creating.value=false;createName.value='';createError.value='';}
function submitCreate(){
  if(!creating.value||working.value)return;
  const issue=createPresetInline(createName.value);
  if(issue){createError.value=issue;return;}
  cancelCreate();
}
function blurCreate(){
  if(!creating.value)return;
  // Losing focus with a valid name commits; an invalid or empty draft is discarded.
  const issue=createPresetInline(createName.value);
  if(issue){cancelCreate();return;}
  cancelCreate();
}
watch(menu,value=>{if(value!=='presets'){cancelRename();cancelCreate();}});
</script>
<template>
  <div class="menu-anchor" @keydown="menuKeyboard">
    <button class="secondary preset-trigger" :disabled="working||!focusNode" aria-haspopup="menu" :aria-expanded="menu==='presets'" @click="toggleMenu('presets')"><AppIcon name="bookmark"/><span class="truncate">{{!focusNode?'先选择文件夹':availablePresets.find(p=>p.id===currentPreset)?.name||'临时选择'}}</span><AppIcon name="chevron-down"/></button>
    <div v-if="menu==='presets'" class="popup-menu preset-menu" role="group" aria-label="选择与管理方案">
      <div class="menu-list" role="group" aria-label="方案列表">
        <div v-if="creating" class="preset-entry preset-create-entry">
          <div class="preset-item preset-item-active">
            <input v-select-all v-model="createName" class="preset-rename-input" maxlength="80" aria-label="新方案名称" :aria-invalid="!!createError" :title="createError||'Enter 保存，Esc 取消'" placeholder="输入方案名称" @input="createError=''" @keydown.stop.enter.prevent="submitCreate" @keydown.stop.esc.prevent="cancelCreate" @keydown.stop @blur="blurCreate"/>
            <button class="preset-direct-action" :disabled="working||!createName.trim()" aria-label="保存新方案" title="保存" @mousedown.prevent @click.stop="submitCreate"><AppIcon name="check"/></button>
            <button class="preset-direct-action" aria-label="取消新建方案" title="取消" @mousedown.prevent @click.stop="cancelCreate"><AppIcon name="x"/></button>
          </div>
        </div>
        <div v-for="p in availablePresets" :key="p.id" class="preset-entry">
          <div class="preset-item" :class="{'preset-item-active':p.id===currentPreset}">
            <template v-if="editingId===p.id">
              <input v-select-all v-model="draftName" class="preset-rename-input" maxlength="80" :aria-label="'重命名方案 '+p.name" :aria-invalid="!!renameError" :title="renameError||'Enter 保存，Esc 取消'" @input="renameError=''" @keydown.stop.enter.prevent="submitRename(p)" @keydown.stop.esc.prevent="cancelRename" @keydown.stop @blur="blurRename(p)"/>
              <button class="preset-direct-action" :disabled="working||!draftName.trim()" aria-label="保存新名称" title="保存" @mousedown.prevent @click.stop="submitRename(p)"><AppIcon name="check"/></button>
              <button class="preset-direct-action" aria-label="取消重命名" title="取消" @mousedown.prevent @click.stop="cancelRename"><AppIcon name="x"/></button>
            </template>
            <template v-else>
              <button class="preset-select" :aria-pressed="p.id===currentPreset" :disabled="working" @click="selectPreset(p)"><span class="truncate">{{p.name}}</span></button>
              <button class="preset-direct-action" :disabled="working" :aria-label="'重命名方案 '+p.name" :title="'重命名 '+p.name" @click.stop="beginRename(p)"><AppIcon name="pencil"/></button>
              <button class="preset-direct-action preset-delete-action" :disabled="working" :aria-label="'删除方案 '+p.name" :title="'删除 '+p.name" @click.stop="askDeletePreset(p)"><AppIcon name="trash-2"/></button>
            </template>
          </div>
        </div>
        <div v-if="!availablePresets.length&&!creating" class="menu-empty">此文件夹暂无方案</div>
      </div>
      <div class="menu-footer preset-footer">
        <button class="preset-footer-action" :disabled="working||!currentPreset" @click="openSave()"><AppIcon name="save"/> 保存修改</button>
        <button class="preset-footer-action" :disabled="working" @click="beginCreate"><AppIcon name="plus"/> 新建方案</button>
      </div>
    </div>
  </div>
</template>
