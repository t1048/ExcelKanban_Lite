/* ===================== ランタイム切替（mock / pywebview） ===================== */
const {
  sanitizeTaskRecord,
  sanitizeTaskList,
  normalizeStatePayload,
  parseISO,
  getDueState,
  getPriorityLevel,
  getAncestorIds,
  getChildCount,
} = window.TaskAppCommon;

const {
  hasInitialExcelLoadFlag,
  resetInitialExcelLoadFlag,
} = window.TaskAppRuntime || {};

const {
  applyValidationState,
  createPriorityHelper,
  normalizeStatusLabel,
  denormalizeStatusLabel,
  PRIORITY_DEFAULT_OPTIONS,
  DEFAULT_STATUSES,
  UNSET_STATUS_LABEL,
} = window.TaskValidation || {};

const {
  constants: {
    ASSIGNEE_FILTER_ALL,
    ASSIGNEE_FILTER_UNASSIGNED,
    ASSIGNEE_UNASSIGNED_LABEL,
  },
} = window.TaskFilterUI;

const { createTaskPageBase } = window.TaskPageBase || {};
const { createExcelSyncHandlers } = window.TaskExcelSync || {};

let api;                  // 実際に使う API （後で差し替える）
let RUN_MODE = 'mock';    // 'mock' | 'pywebview'
let excelSyncHandlers = null;

/* ===================== 状態 ===================== */
const VALIDATION_COLUMNS = ["ステータス", "タスク", "担当者", "優先度", "期限", "備考"];
let STATUSES = [];
let TASKS = [];
let CURRENT_EDIT = null;
let VALIDATIONS = {};
const priorityHelper = createPriorityHelper({
  getValidations: () => VALIDATIONS,
  defaultOptions: PRIORITY_DEFAULT_OPTIONS,
});
const getPriorityOptions = () => priorityHelper.getOptions();
const getDefaultPriorityValue = () => priorityHelper.getDefaultValue();
const applyPriorityOptions = (selectEl, currentValue, preferDefault = false) => (
  priorityHelper.applyOptions(selectEl, currentValue, preferDefault)
);

const WORKLOAD_IN_PROGRESS_KEYWORDS = ['進行', '作業中', 'inprogress', 'wip'];
const WORKLOAD_HEAVY_THRESHOLD = 5;

function workloadInProgressCount(entry) {
  if (!entry || typeof entry !== 'object' || !entry.statusCounts) return 0;
  return Object.entries(entry.statusCounts).reduce((acc, [status, count]) => {
    const numeric = Number(count) || 0;
    if (numeric <= 0) return acc;
    const normalized = String(status ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!normalized) return acc;
    if (WORKLOAD_IN_PROGRESS_KEYWORDS.some(keyword => normalized.includes(keyword))) {
      return acc + numeric;
    }
    return acc;
  }, 0);
}

function workloadHighlightPredicate(entry) {
  return workloadInProgressCount(entry) > WORKLOAD_HEAVY_THRESHOLD;
}

const pageBase = typeof createTaskPageBase === 'function'
  ? createTaskPageBase({
    viewKey: 'kanban-board',
    headerOptions: {
      title: 'タスク・カンバン',
      currentView: 'kanban',
      hint: 'ドラッグ＆ドロップで列に移動できます',
      onAdd: () => openCreate(),
      onSave: () => handleSaveToExcel(),
      onValidations: () => openValidationModal(),
      onReload: () => handleReloadFromExcel(),
    },
    onRender: () => renderBoard(),
    onInit: () => init(true),
    onRealtimeUpdate: (payload) => applyStateFromPayload(payload, { preserveFilters: true, fallbackToApi: false }),
    onSave: () => handleSaveToExcel(),
    onReload: () => handleReloadFromExcel(),
    onApiChanged: ({ api: nextApi, runMode }) => {
      api = nextApi;
      RUN_MODE = runMode;
      console.log('[kanban] run mode:', RUN_MODE);
    },
    getStatuses: () => STATUSES,
    highlightPredicate: (entry) => workloadHighlightPredicate(entry),
    logLabel: 'kanban',
  })
  : {
    headerController: window.TaskAppHeader?.initHeader?.({
      title: 'タスク・カンバン',
      currentView: 'kanban',
      hint: 'ドラッグ＆ドロップで列に移動できます',
      onAdd: () => openCreate(),
      onSave: () => handleSaveToExcel(),
      onValidations: () => openValidationModal(),
      onReload: () => handleReloadFromExcel(),
    }),
    filterController: null,
    workloadSummary: null,
  };

const { filterController, workloadSummary, headerController } = pageBase;

if (typeof createExcelSyncHandlers === 'function') {
  excelSyncHandlers = createExcelSyncHandlers({
    apiAccessor: () => api,
    onAfterValidationSave: async ({ payload, response, closeModal }) => {
      const validationsInput = response?.validations ?? payload;
      const baseStatuses = Array.isArray(response?.statuses) ? response.statuses : STATUSES;
      if (Array.isArray(baseStatuses)) {
        STATUSES = baseStatuses;
      }

      const snapshot = applyValidationState({
        tasks: TASKS,
        statuses: STATUSES,
        validations: validationsInput,
      }) || {};

      if (Array.isArray(snapshot.tasks)) {
        TASKS = snapshot.tasks;
      }
      if (Array.isArray(snapshot.statuses) && snapshot.statuses.length > 0) {
        STATUSES = snapshot.statuses;
      }
      if (snapshot.validations && typeof snapshot.validations === 'object') {
        VALIDATIONS = snapshot.validations;
      }

      filterController?.updateData({
        tasks: TASKS,
        statuses: STATUSES,
        validations: VALIDATIONS,
        preserveStatusSelection: true,
      });

      if (typeof closeModal === 'function') {
        closeModal();
      }

      renderBoard();
    },
  });
}

async function applyStateFromPayload(payload, options = {}) {
  const { preserveFilters = true, fallbackToApi = true } = options;
  const data = normalizeStatePayload(payload);

  if (Array.isArray(data.tasks)) {
    TASKS = sanitizeTaskList(data.tasks);
  }
  if (Array.isArray(data.statuses)) {
    STATUSES = data.statuses;
  }

  let validationPayload = data.validations ?? VALIDATIONS;
  if (!data.validations && fallbackToApi && typeof api?.get_validations === 'function') {
    try {
      validationPayload = await api.get_validations();
    } catch (err) {
      console.warn('get_validations failed:', err);
    }
  }

  const snapshot = applyValidationState({
    tasks: TASKS,
    statuses: STATUSES,
    validations: validationPayload,
  }) || {};
  TASKS = Array.isArray(snapshot.tasks) ? snapshot.tasks : TASKS;
  STATUSES = Array.isArray(snapshot.statuses) ? snapshot.statuses : STATUSES;
  VALIDATIONS = snapshot.validations && typeof snapshot.validations === 'object'
    ? snapshot.validations
    : VALIDATIONS;

  filterController?.updateData({
    tasks: TASKS,
    statuses: STATUSES,
    validations: VALIDATIONS,
    preserveStatusSelection: preserveFilters,
  });
  renderBoard();
}

async function init(force = false) {
  let payload = {};
  if (force) {
    const isPywebview = RUN_MODE === 'pywebview';
    let loadedViaReload = false;
      if (isPywebview && !hasInitialExcelLoadFlag?.() && typeof api.reload_from_excel === 'function') {
      try {
        payload = normalizeStatePayload(await api.reload_from_excel());
        loadedViaReload = true;
      } catch (e) {
        console.warn('reload_from_excel failed, fallback to get_*', e);
        payload = {};
      }
    }

    if (isPywebview && !loadedViaReload && typeof api.get_state_snapshot === 'function') {
      try {
        payload = normalizeStatePayload(await api.get_state_snapshot());
      } catch (err) {
        console.warn('get_state_snapshot failed:', err);
      }
    }

    if (!Array.isArray(payload.tasks) && typeof api.get_tasks === 'function') {
      try {
        payload.tasks = await api.get_tasks();
      } catch (err) {
        console.error('get_tasks failed:', err);
      }
    }

    if (!Array.isArray(payload.statuses) && typeof api.get_statuses === 'function') {
      try {
        payload.statuses = await api.get_statuses();
      } catch (err) {
        console.error('get_statuses failed:', err);
      }
    }
  }

  await applyStateFromPayload(payload, { preserveFilters: true, fallbackToApi: true });
}

/* ===================== レンダリング ===================== */
const KANBAN_TREE_EXPAND_STATE = new Map();

function getChildStats(task, sourceTasks) {
  const id = String(task.__kanban_id ?? '').trim();
  if (!id) return null;
  const children = (sourceTasks || TASKS).filter(t => String(t.__parent_id ?? '').trim() === id);
  if (children.length === 0) return null;
  const total = children.length;
  const completed = children.filter(t => {
    const s = String(t.ステータス ?? '').trim();
    return s === '完了' || s === '完了済み' || s === '完了済';
  }).length;
  return { total, completed, children };
}

function hasChildren(taskId) {
  const id = String(taskId ?? '').trim();
  if (!id) return false;
  return TASKS.some(t => String(t.__parent_id ?? '').trim() === id);
}

function ensureKanbanExpandDefaults(filteredTasks) {
  const list = Array.isArray(filteredTasks) ? filteredTasks : TASKS;
  list.forEach(task => {
    const kanbanId = String(task.__kanban_id ?? '').trim();
    if (!kanbanId) return;
    if (!KANBAN_TREE_EXPAND_STATE.has(kanbanId) && hasChildren(kanbanId)) {
      KANBAN_TREE_EXPAND_STATE.set(kanbanId, true);
    }
  });
}

function getFilteredTasksTreeAware() {
  const base = filterController?.applyFilters(TASKS) ?? TASKS;
  const baseSet = new Set(base.map(t => String(t.__kanban_id ?? '').trim()));
  const ancestorsToAdd = new Set();

  for (const task of base) {
    const pid = String(task.__parent_id ?? '').trim();
    if (!pid) continue;
    const ancestors = getAncestorIds(task.__kanban_id, TASKS) || [];
    ancestors.forEach(id => {
      if (!baseSet.has(id)) ancestorsToAdd.add(id);
    });
  }

  if (ancestorsToAdd.size === 0) return base;

  const parentTasks = TASKS.filter(t => ancestorsToAdd.has(String(t.__kanban_id ?? '').trim()));
  return [...base, ...parentTasks];
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  const FILTERED = getFilteredTasksTreeAware();
  ensureKanbanExpandDefaults(FILTERED);

  const childStatsMap = new Map();
  for (const task of FILTERED) {
    const stats = getChildStats(task, TASKS);
    if (stats) childStatsMap.set(String(task.__kanban_id ?? '').trim(), stats);
  }

  STATUSES.forEach(status => {
    const columnTasks = FILTERED.filter(t => normalizeStatusLabel(t.ステータス) === status);
    if (status === UNSET_STATUS_LABEL && columnTasks.length === 0) {
      return;
    }

    const col = document.createElement('section');
    col.className = 'column';
    col.dataset.status = status;

    const header = document.createElement('div');
    header.className = 'column-header';
    const title = document.createElement('div');
    title.className = 'column-title';
    title.textContent = status;
    const count = document.createElement('div');
    count.className = 'column-count';
    count.textContent = `${columnTasks.length} 件`;

    header.appendChild(title);
    header.appendChild(count);

    const body = document.createElement('div');
    body.className = 'column-body';
    const drop = document.createElement('div');
    drop.className = 'dropzone';
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => onDropCard(e, status, drop));

    const sorted = columnTasks.slice().sort((a, b) => {
      const aRoot = !a.__parent_id;
      const bRoot = !b.__parent_id;
      if (aRoot && !bRoot) return -1;
      if (!aRoot && bRoot) return 1;
      return compareDueValues(a, b)
        || comparePriorityValues(a.優先度, b.優先度)
        || (a.No || 0) - (b.No || 0);
    });

    const renderedIds = new Set();
    const renderList = [];

    sorted.forEach(task => {
      const kanbanId = String(task.__kanban_id ?? '').trim();
      if (renderedIds.has(kanbanId)) return;

      const parentId = String(task.__parent_id ?? '').trim();
      if (parentId && renderedIds.has(parentId)) return;

      const stats = childStatsMap.get(kanbanId) || null;
      const expanded = stats && KANBAN_TREE_EXPAND_STATE.get(kanbanId) !== false;

      renderList.push({ task, stats, depth: 0 });
      renderedIds.add(kanbanId);

      if (expanded && stats) {
        stats.children.forEach(child => {
          const cid = String(child.__kanban_id ?? '').trim();
          if (renderedIds.has(cid)) return;
          if (normalizeStatusLabel(child.ステータス) !== status) return;
          renderList.push({ task: child, stats: null, depth: 1 });
          renderedIds.add(cid);
        });
      }
    });

    renderList.forEach(({ task, stats, depth }) => {
      drop.appendChild(renderCard(task, { depth, childStats: stats }));
    });

    body.appendChild(drop);
    col.appendChild(header);
    col.appendChild(body);
    board.appendChild(col);
  });

  if (headerController && typeof headerController.updateDueSummary === 'function') {
    headerController.updateDueSummary(FILTERED);
  } else {
    window.TaskAppHeader?.updateDueSummary(FILTERED);
  }
  buildAssigneeWorkload(FILTERED);
}


function buildAssigneeWorkload(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  workloadSummary?.update(list, {
    total: list.length,
    overall: Array.isArray(TASKS) ? TASKS.length : list.length,
  });
}


function uniqAssignees() {
  const set = new Set();
  TASKS.forEach(t => { if ((t.担当者 || '').trim()) set.add(t.担当者.trim()); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
}

const PRIORITY_LABEL_ORDER = new Map([
  ['最優先', 0],
  ['緊急', 0],
  ['高', 1],
  ['High', 1],
  ['中', 2],
  ['Medium', 2],
  ['低', 3],
  ['Low', 3],
  ['通常', 4],
  ['Normal', 4],
  ['後回し', 5],
  ['Low Priority', 5],
]);

function prioritySortKey(value) {
  if (value === null || value === undefined) return { weight: 1001, label: '' };
  if (typeof value === 'number' && !Number.isNaN(value)) return { weight: value, label: '' };
  const str = String(value).trim();
  if (!str) return { weight: 1001, label: '' };
  const num = Number(str);
  if (!Number.isNaN(num)) return { weight: num, label: '' };
  if (PRIORITY_LABEL_ORDER.has(str)) return { weight: PRIORITY_LABEL_ORDER.get(str), label: '' };
  return { weight: 1000, label: str };
}

function comparePriorityValues(a, b) {
  const ka = prioritySortKey(a);
  const kb = prioritySortKey(b);
  if (ka.weight !== kb.weight) return ka.weight - kb.weight;
  return ka.label.localeCompare(kb.label, 'ja');
}

function compareDueValues(a, b) {
  const da = parseISO(a?.期限 || '');
  const db = parseISO(b?.期限 || '');
  if (da && db) {
    const diff = da.getTime() - db.getTime();
    if (diff !== 0) return diff;
    return 0;
  }
  if (da) return -1;
  if (db) return 1;
  return 0;
}

function renderCard(task, options = {}) {
  const { depth = 0, childStats = null } = options;

  const el = document.createElement('article');
  el.className = 'card';
  if (depth > 0) el.classList.add('card-child');
  el.draggable = true;
  el.dataset.no = task.No;
  el.dataset.kanbanId = task.__kanban_id || '';

  const dueState = getDueState(task);
  if (dueState?.level === 'overdue') {
    el.classList.add('due-overdue');
  } else if (dueState?.level === 'warning') {
    el.classList.add('due-warning');
  }

  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', String(task.No));
    e.dataTransfer.effectAllowed = 'move';
  });

  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('card-dragover');
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('card-dragover');
  });

  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('card-dragover');
    onDropToCard(e, task.No);
  });

  el.addEventListener('dblclick', () => openEdit(task.No));

  const header = document.createElement('div');
  header.className = 'card-header';

  if (depth > 0) {
    const indent = document.createElement('span');
    indent.className = 'card-child-arrow';
    indent.textContent = '↳';
    header.appendChild(indent);
  }

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = task.タスク || '(無題)';
  const no = document.createElement('div');
  no.className = 'card-no';
  no.textContent = `#${task.No}`;
  header.appendChild(title);
  header.appendChild(no);

  const parentLabel = document.createElement('div');
  parentLabel.className = 'card-parent-label';
  if (task.__parent_id && depth === 0) {
    const parentTask = TASKS.find(t => String(t.__kanban_id ?? '').trim() === task.__parent_id);
    const parentName = parentTask ? (parentTask.タスク || '(無題)') : task.__parent_id;
    parentLabel.innerHTML = `<span class="parent-arrow">&darr;</span> <span class="parent-link" data-parent-id="${task.__parent_id}">${parentName}</span>`;
  }

  el.appendChild(header);
  if (task.__parent_id && depth === 0) {
    el.appendChild(parentLabel);
  }

  if (childStats && childStats.total > 0) {
    const childInfo = document.createElement('div');
    childInfo.className = 'card-child-info';

    const kanbanId = String(task.__kanban_id ?? '').trim();
    const expanded = KANBAN_TREE_EXPAND_STATE.get(kanbanId) !== false;

    const topRow = document.createElement('div');
    topRow.className = 'card-child-top';

    const toggle = document.createElement('span');
    toggle.className = 'card-child-toggle';
    toggle.textContent = expanded ? '▼' : '▶';
    toggle.title = expanded ? '子タスクを折りたたむ' : '子タスクを展開';
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const cur = KANBAN_TREE_EXPAND_STATE.get(kanbanId) !== false;
      KANBAN_TREE_EXPAND_STATE.set(kanbanId, !cur);
      renderBoard();
    });
    topRow.appendChild(toggle);

    const badge = document.createElement('span');
    badge.className = 'card-child-badge';
    badge.textContent = `${childStats.total}件の子タスク`;
    topRow.appendChild(badge);

    topRow.appendChild(document.createElement('span'));

    childInfo.appendChild(topRow);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'card-child-progress-wrap';

    const progress = document.createElement('div');
    progress.className = 'card-child-progress';
    const bar = document.createElement('div');
    bar.className = 'card-child-progress-bar';
    const pct = Math.round(childStats.completed / childStats.total * 100);
    bar.style.width = `${pct}%`;
    if (pct === 100) bar.classList.add('complete');
    progress.appendChild(bar);
    progressWrap.appendChild(progress);

    const label = document.createElement('span');
    label.className = 'card-child-progress-label';
    label.textContent = `${childStats.completed}/${childStats.total} 完了`;
    if (pct === 100) label.classList.add('complete');
    progressWrap.appendChild(label);

    childInfo.appendChild(progressWrap);
    el.appendChild(childInfo);
  }

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  if (task.優先度 !== undefined && task.優先度 !== null && String(task.優先度).trim() !== '') {
    const bp = document.createElement('span');
    bp.className = 'badge badge-priority';
    bp.textContent = `優先度: ${task.優先度}`;
    const priorityLevel = getPriorityLevel(task.優先度);
    if (priorityLevel && priorityLevel !== 'unset' && priorityLevel !== 'custom') {
      bp.classList.add(`badge-priority-${priorityLevel}`);
    }
    meta.appendChild(bp);
  }
  if (task.担当者) {
    const b1 = document.createElement('span'); b1.className = 'badge badge-assignee'; b1.textContent = task.担当者; meta.appendChild(b1);
  }
  if (task.期限) {
    const b2 = document.createElement('span');
    b2.className = 'badge badge-date';
    let dueText = task.期限;
    if (dueState) {
      dueText += `（${dueState.label}）`;
      if (dueState.level === 'overdue') b2.classList.add('due-overdue');
      if (dueState.level === 'warning') b2.classList.add('due-warning');
    }
    b2.textContent = dueText;
    meta.appendChild(b2);
  }

  const notes = document.createElement('div');
  notes.className = 'card-notes';
  notes.textContent = task.備考 || '';

  el.appendChild(meta);
  el.appendChild(notes);
  return el;
}

/* ===================== DnD ===================== */
async function onDropCard(e, newStatus, dropzone) {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const no = parseInt(e.dataTransfer.getData('text/plain'), 10);
  if (!no) return;

  try {
    const nextStatus = denormalizeStatusLabel(newStatus);
    await api.move_task(no, nextStatus);
    const idx = TASKS.findIndex(t => t.No === no);
    if (idx >= 0) TASKS[idx].ステータス = nextStatus;
    renderBoard();
  } catch (err) {
    alert('移動に失敗しました: ' + (err?.message || err));
  }
}

async function onDropToCard(e, targetNo) {
  const no = parseInt(e.dataTransfer.getData('text/plain'), 10);
  if (!no || no === targetNo) return;

  const targetTask = TASKS.find(t => t.No === targetNo);
  const sourceTask = TASKS.find(t => t.No === no);
  if (!targetTask || !sourceTask) return;

  const targetId = String(targetTask.__kanban_id ?? '').trim();
  const sourceId = String(sourceTask.__kanban_id ?? '').trim();

  const targetParentId = String(targetTask.__parent_id ?? '').trim();
  if (targetParentId && targetParentId === sourceId) {
    if (!confirm('このカードを親から外しますか？')) return;
    try {
      await api.update_task(no, { __parent_id: '' });
      TASKS = sanitizeTaskList(await api.get_tasks());
    } catch (err) {
      alert('親子関係の解除に失敗しました: ' + (err?.message || err));
    }
    renderBoard();
    return;
  }

  if (getAncestorIds(targetId, TASKS).includes(sourceId)) {
    alert('循環参照になるため設定できません。');
    return;
  }

  if (!confirm(`「${sourceTask.タスク}」を「${targetTask.タスク}」の子タスクにしますか？`)) return;

  try {
    await api.update_task(no, { __parent_id: targetId });
    TASKS = sanitizeTaskList(await api.get_tasks());
    if (typeof window.showToast === 'function') {
      window.showToast('親タスクを設定しました', 'success');
    }
  } catch (err) {
    alert('親子関係の設定に失敗しました: ' + (err?.message || err));
  }
  renderBoard();
}

/* ===================== ツールバー ===================== */
function handleSaveToExcel() {
  if (excelSyncHandlers?.handleSaveToExcel) {
    return excelSyncHandlers.handleSaveToExcel();
  }
  alert('保存機能が利用できません。');
}

async function handleReloadFromExcel() {
  if (!excelSyncHandlers?.handleReloadFromExcel) {
    alert('再読込機能が利用できません。');
    return;
  }
  await excelSyncHandlers.handleReloadFromExcel({
    onBeforeReload: () => resetInitialExcelLoadFlag?.(),
    onAfterReload: (payload) => applyStateFromPayload(payload, { preserveFilters: true, fallbackToApi: true }),
  });
}

/* ===================== 入力規則モーダル ===================== */
function openValidationModal(options = {}) {
  if (!excelSyncHandlers?.openValidationModal) return;
  excelSyncHandlers.openValidationModal({
    columns: VALIDATION_COLUMNS,
    getCurrentValues: () => VALIDATIONS,
    onAfterRender: options.onAfterRender,
  });
}

function getFilteredTasks() {
  return getFilteredTasksTreeAware();
}


/* ===================== モーダル: 追加/編集 ===================== */
function openCreate(defaults = {}) {
  CURRENT_EDIT = null;
  openModal({
    No: '',
    ステータス: STATUSES[0] || '未着手',
    __parent_id: defaults.parent_id || '',
    タスク: '',
    担当者: '',
    優先度: getDefaultPriorityValue(),
    期限: '',
    備考: ''
  }, { mode: 'create' });
}
function openEdit(no) {
  const t = TASKS.find(x => x.No === no);
  if (!t) return;
  CURRENT_EDIT = no;
  openModal(t, { mode: 'edit' });
}

function setupAssigneeInputSuggestions(fassignee) {
  const datalist = document.getElementById('modal-assignee-list');
  if (!fassignee || !datalist) return;

  const candidates = Array.isArray(TASKS) ? uniqAssignees() : [];
  const seen = new Set();
  datalist.innerHTML = '';

  candidates.forEach(name => {
    const text = String(name ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    const opt = document.createElement('option');
    opt.value = text;
    datalist.appendChild(opt);
  });

  const current = String(fassignee.value ?? '').trim();
  if (current && !seen.has(current)) {
    const opt = document.createElement('option');
    opt.value = current;
    datalist.appendChild(opt);
    seen.add(current);
  }

  fassignee.setAttribute('list', datalist.id);
}

function openModal(task, { mode }) {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const fno = document.getElementById('f-no');
  const fstat = document.getElementById('f-status');
  const fparent = document.getElementById('f-parent');
  const fparentHidden = document.getElementById('f-parent-hidden');
  const fttl = document.getElementById('f-title');
  const fwho = document.getElementById('f-assignee');
  const fprio = document.getElementById('f-priority');
  const fdue = document.getElementById('f-due');
  const fnote = document.getElementById('f-notes');
  const btnDelete = document.getElementById('btn-delete');
  const btnAddChildTask = document.getElementById('btn-add-child-task');

  title.textContent = mode === 'create' ? 'タスク追加' : 'タスク編集';

  // ステータス選択肢
  fstat.innerHTML = '';
  STATUSES.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    fstat.appendChild(opt);
  });

  fno.value = task.No ?? '';
  fstat.value = task.ステータス || STATUSES[0] || '未着手';

  // 親タスク選択UI
  if (fparent && fparentHidden) {
    const currentParentId = task.__parent_id || '';
    fparentHidden.value = currentParentId;
    if (currentParentId) {
      const parentTask = TASKS.find(t => String(t.__kanban_id ?? '').trim() === currentParentId);
      fparent.value = parentTask ? parentTask.タスク : currentParentId;
    } else {
      fparent.value = '';
    }
    if (typeof window.TaskModalHelper?.setupParentTaskSelector === 'function') {
      window.TaskModalHelper.setupParentTaskSelector(fparent, fparentHidden, TASKS, task.__kanban_id || '');
    }
  }

  fttl.value = task.タスク || '';
  fwho.value = task.担当者 || '';
  setupAssigneeInputSuggestions(fwho);
  applyPriorityOptions(fprio, task.優先度, mode === 'create');
  fdue.value = (task.期限 || '').slice(0, 10);
  fnote.value = task.備考 || '';

  btnDelete.style.display = (mode === 'edit') ? 'inline-flex' : 'none';

  // ハンドラ
  document.getElementById('btn-close').onclick = closeModal;
  document.getElementById('btn-cancel').onclick = closeModal;
  btnDelete.onclick = async () => {
    if (!CURRENT_EDIT) return;
    const currentTask = TASKS.find(x => x.No === CURRENT_EDIT);
    const childCount = currentTask ? TASKS.filter(t => String(t.__parent_id ?? '').trim() === String(currentTask.__kanban_id ?? '').trim()).length : 0;
    let confirmMsg = '削除しますか？';
    if (childCount > 0) {
      confirmMsg = `このタスクには ${childCount} 件の子タスクがあります。子タスクもすべて削除しますか？\n\nOK = すべて削除 / キャンセル = 削除中止`;
    }
    if (!confirm(confirmMsg)) return;
    try {
      const ok = await api.delete_task(CURRENT_EDIT, true);
      if (ok) {
        if (typeof api.get_tasks === 'function') {
          TASKS = sanitizeTaskList(await api.get_tasks());
        } else {
          const remaining = TASKS
            .filter(x => x.No !== CURRENT_EDIT)
            .map((task, idx) => ({ ...task, No: idx + 1 }));
          TASKS = sanitizeTaskList(remaining);
        }
        CURRENT_EDIT = null;
        closeModal();
        filterController?.updateData({
          tasks: TASKS,
          statuses: STATUSES,
          validations: VALIDATIONS,
          preserveStatusSelection: true,
        });
        renderBoard();
      } else {
        alert('削除できませんでした');
      }
    } catch (e) {
      alert('削除に失敗: ' + (e?.message || e));
    }
  };

  btnAddChildTask.onclick = async () => {
    const payload = {
      ステータス: denormalizeStatusLabel(fstat.value),
      __parent_id: fparentHidden ? fparentHidden.value.trim() : '',
      タスク: fttl.value.trim(),
      担当者: fwho.value.trim(),
      優先度: (fprio.value ?? '').trim(),
      期限: fdue.value ? fdue.value : '',
      備考: fnote.value
    };

    if (!payload.タスク) {
      alert('タスクを入力してください。');
      fttl.focus();
      return;
    }

    try {
      let savedKanbanId = null;
      if (mode === 'create') {
        const created = await api.add_task(payload);
        const sanitized = sanitizeTaskRecord(created, TASKS.length);
        if (sanitized) {
          TASKS.push(sanitized);
          savedKanbanId = sanitized.__kanban_id || null;
        }
      } else {
        const no = CURRENT_EDIT;
        const updated = await api.update_task(no, payload);
        const i = TASKS.findIndex(x => x.No === no);
        if (i >= 0) {
          const sanitized = sanitizeTaskRecord(updated, i);
          if (sanitized) {
            TASKS[i] = sanitized;
            savedKanbanId = sanitized.__kanban_id || null;
          } else {
            TASKS.splice(i, 1);
          }
        }
      }
      CURRENT_EDIT = null;
      closeModal();
      filterController?.updateData({
        tasks: TASKS,
        statuses: STATUSES,
        validations: VALIDATIONS,
        preserveStatusSelection: true,
      });
      renderBoard();
      if (savedKanbanId) {
        openCreate({ parent_id: savedKanbanId });
      }
    } catch (err) {
      alert('保存に失敗: ' + (err?.message || err));
    }
  };

  const form = document.getElementById('task-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      ステータス: denormalizeStatusLabel(fstat.value),
      __parent_id: fparentHidden ? fparentHidden.value.trim() : '',
      タスク: fttl.value.trim(),
      担当者: fwho.value.trim(),
      優先度: (fprio.value ?? '').trim(),
      期限: fdue.value ? fdue.value : '',
      備考: fnote.value
    };

    if (!payload.タスク) {
      alert('タスクを入力してください。');
      fttl.focus();
      return;
    }

    try {
      if (mode === 'create') {
        const created = await api.add_task(payload);
        const sanitized = sanitizeTaskRecord(created, TASKS.length);
        if (sanitized) {
          TASKS.push(sanitized);
        }
      } else {
        const no = CURRENT_EDIT;
        const updated = await api.update_task(no, payload);
        const i = TASKS.findIndex(x => x.No === no);
        if (i >= 0) {
          const sanitized = sanitizeTaskRecord(updated, i);
          if (sanitized) {
            TASKS[i] = sanitized;
          } else {
            TASKS.splice(i, 1);
          }
        }
      }
      closeModal();
      filterController?.updateData({
        tasks: TASKS,
        statuses: STATUSES,
        validations: VALIDATIONS,
        preserveStatusSelection: true,
      });
      renderBoard();
    } catch (err) {
      alert('保存に失敗: ' + (err?.message || err));
    }
  };

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
