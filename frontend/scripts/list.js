/* ===================== ランタイム切替（mock / pywebview） ===================== */
const {
  sanitizeTaskRecord,
  sanitizeTaskList,
  normalizeStatePayload,
  parseISO,
  getDueState,
  getPriorityLevel,
  getAncestorIds,
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
const TREE_EXPAND_STATE = new Map();
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

const STATUS_CLASS_MAP = new Map([
  ['進行中', 'status-pill--in-progress'],
  ['保留', 'status-pill--on-hold'],
  ['完了', 'status-pill--done'],
]);

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
    viewKey: 'kanban-list',
    headerOptions: {
      title: 'タスク・リスト',
      currentView: 'list',
      onAdd: () => openCreate(),
      onSave: () => handleSaveToExcel(),
      onValidations: () => openValidationModal(),
      onReload: () => handleReloadFromExcel(),
    },
    onRender: () => renderList(),
    onInit: () => init(true),
    onRealtimeUpdate: (payload) => applyStateFromPayload(payload, { preserveFilters: true, fallbackToApi: false }),
    onSave: () => handleSaveToExcel(),
    onReload: () => handleReloadFromExcel(),
    onApiChanged: ({ api: nextApi, runMode }) => {
      api = nextApi;
      RUN_MODE = runMode;
      console.log('[list] run mode:', RUN_MODE);
    },
    getStatuses: () => STATUSES,
    highlightPredicate: (entry) => workloadHighlightPredicate(entry),
    logLabel: 'list',
  })
  : {
    headerController: window.TaskAppHeader?.initHeader?.({
      title: 'タスク・リスト',
      currentView: 'list',
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

      renderList();
    },
  });
}

function updateHeaderDueSummary(tasks) {
  if (headerController && typeof headerController.updateDueSummary === 'function') {
    headerController.updateDueSummary(tasks);
  } else {
    window.TaskAppHeader?.updateDueSummary(tasks);
  }
}

const STATUS_SORT_SEQUENCE = ['', UNSET_STATUS_LABEL, '未着手', '進行中', '完了', '保留中'];

const TABLE_COLUMN_CONFIG = [
  { key: 'no', label: 'No', width: 70, minWidth: 60, sortable: true },
  { key: 'task', label: 'タスク', sortable: true, className: 'col-task', minWidth: 260 },
  { key: 'parent', label: '親タスク', width: 160, minWidth: 120, sortable: false },
  { key: 'status', label: 'ステータス', width: 160, minWidth: 140, sortable: true },
  { key: 'assignee', label: '担当者', width: 160, minWidth: 140, sortable: true },
  { key: 'priority', label: '優先度', width: 140, minWidth: 120, sortable: true },
  { key: 'due', label: '期限', width: 160, minWidth: 140, sortable: true },
  { key: 'notes', label: '備考', sortable: false, className: 'col-notes', minWidth: 280 }
];

const COLUMN_CONFIG_BY_KEY = new Map();
TABLE_COLUMN_CONFIG.forEach((col, index) => {
  col.index = index;
  COLUMN_CONFIG_BY_KEY.set(col.key, col);
});

const COLUMN_WIDTH_STORAGE_KEY = 'taskList.columnWidths';
let COLUMN_WIDTHS = loadColumnWidths();

let horizontalScrollInitialized = false;
let horizontalScrollSyncing = false;
let horizontalScrollElements = null;
let pendingHorizontalScrollbarUpdate = false;

function getHorizontalScrollElements() {
  if (horizontalScrollElements) {
    const { scroller, bar, inner } = horizontalScrollElements;
    if (scroller?.isConnected && bar?.isConnected && inner?.isConnected) {
      return horizontalScrollElements;
    }
  }
  const scroller = document.getElementById('list-panel-scroll');
  const bar = document.getElementById('list-scrollbar');
  const inner = document.getElementById('list-scrollbar-inner');
  if (!scroller || !bar || !inner) {
    horizontalScrollElements = null;
    return null;
  }
  horizontalScrollElements = { scroller, bar, inner };
  return horizontalScrollElements;
}

function ensureHorizontalScrollBindings() {
  const elements = getHorizontalScrollElements();
  if (!elements) return null;
  if (!horizontalScrollInitialized) {
    const { scroller, bar } = elements;
    const syncFromScroller = () => {
      if (horizontalScrollSyncing) return;
      horizontalScrollSyncing = true;
      bar.scrollLeft = scroller.scrollLeft;
      window.requestAnimationFrame(() => {
        horizontalScrollSyncing = false;
      });
    };
    const syncFromBar = () => {
      if (horizontalScrollSyncing) return;
      horizontalScrollSyncing = true;
      scroller.scrollLeft = bar.scrollLeft;
      window.requestAnimationFrame(() => {
        horizontalScrollSyncing = false;
      });
    };
    scroller.addEventListener('scroll', syncFromScroller, { passive: true });
    bar.addEventListener('scroll', syncFromBar, { passive: true });
    horizontalScrollInitialized = true;
  }
  return elements;
}

function updateHorizontalScrollbar(table) {
  const elements = ensureHorizontalScrollBindings();
  if (!elements) return;
  const { scroller, bar, inner } = elements;
  const tableWidth = table?.scrollWidth ?? 0;
  const scrollerWidth = scroller?.scrollWidth ?? 0;
  const maxWidth = Math.max(tableWidth, scrollerWidth, bar.clientWidth);
  inner.style.width = `${Math.max(0, Math.round(maxWidth))}px`;

  const currentLeft = scroller.scrollLeft;
  horizontalScrollSyncing = true;
  if (Math.abs(bar.scrollLeft - currentLeft) > 1) {
    bar.scrollLeft = currentLeft;
  }
  window.requestAnimationFrame(() => {
    horizontalScrollSyncing = false;
  });

  if (maxWidth <= bar.clientWidth + 1) {
    bar.classList.add('is-scroll-disabled');
  } else {
    bar.classList.remove('is-scroll-disabled');
  }
}

function scheduleHorizontalScrollbarUpdate() {
  if (pendingHorizontalScrollbarUpdate) return;
  pendingHorizontalScrollbarUpdate = true;
  window.requestAnimationFrame(() => {
    pendingHorizontalScrollbarUpdate = false;
    const table = document.querySelector('#list-container table.task-list');
    updateHorizontalScrollbar(table || null);
  });
}

function numericWidth(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getColumnMinWidth(col) {
  if (!col) return 60;
  if (typeof col.minWidth === 'number' && Number.isFinite(col.minWidth)) {
    return col.minWidth;
  }
  const parsed = numericWidth(col.minWidth);
  return Number.isFinite(parsed) ? parsed : 60;
}

function getStoredColumnWidth(columnKey) {
  if (!COLUMN_WIDTHS || typeof COLUMN_WIDTHS !== 'object') return undefined;
  const value = COLUMN_WIDTHS[columnKey];
  const numeric = numericWidth(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function setStoredColumnWidth(columnKey, value) {
  const numeric = numericWidth(value);
  if (!Number.isFinite(numeric)) return;
  if (!COLUMN_WIDTHS || typeof COLUMN_WIDTHS !== 'object') {
    COLUMN_WIDTHS = {};
  }
  COLUMN_WIDTHS[columnKey] = Math.max(0, Math.round(numeric));
}

function loadColumnWidths() {
  try {
    const raw = window.localStorage?.getItem(COLUMN_WIDTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const numeric = numericWidth(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        result[key] = Math.round(numeric);
      }
    });
    return result;
  } catch (err) {
    console.warn('[list] failed to load column widths', err);
    return {};
  }
}

function saveColumnWidths() {
  try {
    window.localStorage?.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(COLUMN_WIDTHS || {}));
  } catch (err) {
    console.warn('[list] failed to save column widths', err);
  }
}

let SORT_STATE = [];

function normalizedText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function compareLocaleStrings(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'ja');
}

function normalizeCategoryValue(value) {
  return String(value ?? '').trim();
}

function statusSortWeight(name) {
  const normalized = normalizeStatusLabel(name);
  const idx = STATUS_SORT_SEQUENCE.indexOf(normalized);
  if (idx >= 0) return idx;
  const trimmed = normalizedText(name);
  const legacyIdx = STATUS_SORT_SEQUENCE.indexOf(trimmed);
  return legacyIdx >= 0 ? legacyIdx : 100;
}

function compareStatusValues(a, b) {
  const sa = normalizeStatusLabel(a?.ステータス);
  const sb = normalizeStatusLabel(b?.ステータス);
  const wa = statusSortWeight(sa);
  const wb = statusSortWeight(sb);
  if (wa !== wb) return wa - wb;
  return sa.localeCompare(sb, 'ja');
}

function compareTaskValues(a, b) {
  const ta = normalizedText(a?.タスク);
  const tb = normalizedText(b?.タスク);
  return compareLocaleStrings(ta, tb);
}

function compareAssigneeValues(a, b) {
  const aa = normalizedText(a?.担当者);
  const ab = normalizedText(b?.担当者);
  return compareLocaleStrings(aa, ab);
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

function compareNoValues(a, b) {
  const sa = normalizedText(a?.No);
  const sb = normalizedText(b?.No);
  const na = Number(sa);
  const nb = Number(sb);
  const validA = sa !== '' && Number.isFinite(na);
  const validB = sb !== '' && Number.isFinite(nb);
  if (validA && validB) {
    if (na !== nb) return na - nb;
    return 0;
  }
  if (validA) return -1;
  if (validB) return 1;
  return sa.localeCompare(sb, 'ja');
}

const SORT_COMPARATORS = {
  no: compareNoValues,
  status: compareStatusValues,
  task: compareTaskValues,
  assignee: compareAssigneeValues,
  priority: (a, b) => comparePriorityValues(a?.優先度, b?.優先度),
  due: compareDueValues,
};

function getEffectiveColumnWidth(columnKey) {
  const column = COLUMN_CONFIG_BY_KEY.get(columnKey);
  const stored = getStoredColumnWidth(columnKey);
  if (Number.isFinite(stored)) return stored;
  if (column?.width !== undefined) {
    const numeric = numericWidth(column.width);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function applyColumnBaseStyles(cell, columnKey) {
  const column = COLUMN_CONFIG_BY_KEY.get(columnKey);
  if (!column) return;
  cell.classList.add(`col-${columnKey}`);
  const minWidth = getColumnMinWidth(column);
  if (Number.isFinite(minWidth) && minWidth > 0) {
    cell.style.minWidth = `${minWidth}px`;
  }
  const width = getEffectiveColumnWidth(columnKey);
  if (Number.isFinite(width) && width > 0) {
    cell.style.width = `${width}px`;
  }
}

function applyColumnWidth(table, columnKey, width) {
  const column = COLUMN_CONFIG_BY_KEY.get(columnKey);
  if (!column) return;
  const minWidth = getColumnMinWidth(column);
  const normalized = Math.max(minWidth, Math.round(width));
  const px = `${normalized}px`;

  const headerCell = table.querySelector(`thead th[data-column-key="${columnKey}"]`);
  if (headerCell) {
    headerCell.style.width = px;
    headerCell.style.minWidth = `${minWidth}px`;
  }

  const colElement = table.querySelector(`col[data-column-key="${columnKey}"]`);
  if (colElement) {
    colElement.style.width = px;
  }

  table.querySelectorAll(`tbody tr`).forEach(row => {
    const cell = row.children[column.index];
    if (cell) {
      cell.style.width = px;
      cell.style.minWidth = `${minWidth}px`;
    }
  });
}

let columnResizeState = null;

function startColumnResize(ev, table, columnKey) {
  if (ev.button !== undefined && ev.button !== 0) return;
  const column = COLUMN_CONFIG_BY_KEY.get(columnKey);
  if (!column) return;
  if (typeof ev.preventDefault === 'function') ev.preventDefault();
  if (typeof ev.stopPropagation === 'function') ev.stopPropagation();

  const clientX = typeof ev.clientX === 'number' ? ev.clientX : (ev.touches?.[0]?.clientX ?? 0);
  const headerCell = table.querySelector(`thead th[data-column-key="${columnKey}"]`);
  const startWidth = headerCell ? headerCell.getBoundingClientRect().width : getEffectiveColumnWidth(columnKey) || getColumnMinWidth(column);

  columnResizeState = {
    table,
    columnKey,
    startX: clientX,
    startWidth,
    minWidth: getColumnMinWidth(column),
    lastWidth: startWidth,
  };

  const usePointerEvents = 'PointerEvent' in window;
  if (usePointerEvents) {
    document.addEventListener('pointermove', handleColumnResizeMove);
    document.addEventListener('pointerup', handleColumnResizeEnd);
    document.addEventListener('pointercancel', handleColumnResizeEnd);
  } else {
    document.addEventListener('mousemove', handleColumnResizeMove);
    document.addEventListener('mouseup', handleColumnResizeEnd);
    document.addEventListener('touchmove', handleColumnResizeMove, { passive: false });
    document.addEventListener('touchend', handleColumnResizeEnd);
    document.addEventListener('touchcancel', handleColumnResizeEnd);
  }
  document.body.classList.add('is-column-resizing');
}

function handleColumnResizeMove(ev) {
  if (!columnResizeState) return;
  if ('buttons' in ev && ev.buttons === 0) {
    handleColumnResizeEnd(ev);
    return;
  }
  if (typeof ev.preventDefault === 'function') ev.preventDefault();
  const clientX = typeof ev.clientX === 'number' ? ev.clientX : (ev.touches?.[0]?.clientX ?? columnResizeState.startX);
  const delta = clientX - columnResizeState.startX;
  const nextWidth = Math.max(columnResizeState.minWidth, columnResizeState.startWidth + delta);
  applyColumnWidth(columnResizeState.table, columnResizeState.columnKey, nextWidth);
  columnResizeState.lastWidth = nextWidth;
  scheduleHorizontalScrollbarUpdate();
}

function handleColumnResizeEnd() {
  if (!columnResizeState) return;
  if ('PointerEvent' in window) {
    document.removeEventListener('pointermove', handleColumnResizeMove);
    document.removeEventListener('pointerup', handleColumnResizeEnd);
    document.removeEventListener('pointercancel', handleColumnResizeEnd);
  } else {
    document.removeEventListener('mousemove', handleColumnResizeMove);
    document.removeEventListener('mouseup', handleColumnResizeEnd);
    document.removeEventListener('touchmove', handleColumnResizeMove);
    document.removeEventListener('touchend', handleColumnResizeEnd);
    document.removeEventListener('touchcancel', handleColumnResizeEnd);
  }
  document.body.classList.remove('is-column-resizing');

  if (Number.isFinite(columnResizeState.lastWidth)) {
    setStoredColumnWidth(columnResizeState.columnKey, columnResizeState.lastWidth);
    saveColumnWidths();
  }
  scheduleHorizontalScrollbarUpdate();
  columnResizeState = null;
}

function defaultListComparator(a, b, statusOrder) {
  const normalizedA = normalizeStatusLabel(a.ステータス);
  const normalizedB = normalizeStatusLabel(b.ステータス);
  const sa = statusOrder.has(normalizedA) ? statusOrder.get(normalizedA) : 999;
  const sb = statusOrder.has(normalizedB) ? statusOrder.get(normalizedB) : 999;
  if (sa !== sb) return sa - sb;
  const due = compareDueValues(a, b);
  if (due !== 0) return due;
  const pri = comparePriorityValues(a.優先度, b.優先度);
  if (pri !== 0) return pri;
  return compareNoValues(a, b);
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
  renderList();
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
function renderList() {
  const container = document.getElementById('list-container');
  if (!container) return;

  const filtered = getFilteredTasks();

  buildAssigneeWorkload(filtered);

  container.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.textContent = '該当するタスクはありません。';
    container.appendChild(empty);
    updateHorizontalScrollbar(null);
    updateHeaderDueSummary(filtered);
    return;
  }

  const statusOrder = new Map();
  STATUSES.forEach((s, idx) => { statusOrder.set(s, idx); });

  const table = document.createElement('table');
  table.className = 'task-list';

  const colgroup = document.createElement('colgroup');
  TABLE_COLUMN_CONFIG.forEach(col => {
    const colEl = document.createElement('col');
    colEl.dataset.columnKey = col.key;
    const width = getEffectiveColumnWidth(col.key);
    if (Number.isFinite(width) && width > 0) {
      colEl.style.width = `${width}px`;
    }
    colgroup.appendChild(colEl);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  TABLE_COLUMN_CONFIG.forEach(col => {
    const th = document.createElement('th');
    th.dataset.columnKey = col.key;
    applyColumnBaseStyles(th, col.key);
    if (col.className) th.classList.add(col.className);
    th.textContent = col.label;
    if (col.sortable) {
      th.classList.add('sortable');
      th.setAttribute('aria-sort', 'none');
      th.tabIndex = 0;
      th.addEventListener('click', () => handleSortToggle(col.key));
      th.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          handleSortToggle(col.key);
        }
      });
    }
    th.classList.add('resizable');
    const resizer = document.createElement('div');
    resizer.className = 'column-resizer';
    resizer.title = '列幅を変更';
    if ('PointerEvent' in window) {
      resizer.addEventListener('pointerdown', (ev) => startColumnResize(ev, table, col.key));
    } else {
      resizer.addEventListener('mousedown', (ev) => startColumnResize(ev, table, col.key));
      resizer.addEventListener('touchstart', (ev) => startColumnResize(ev, table, col.key), { passive: false });
    }
    resizer.addEventListener('click', (ev) => ev.stopPropagation());
    th.appendChild(resizer);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  applySortHeaderState(thead);

  const tbody = document.createElement('tbody');

  const activeSorts = SORT_STATE.filter(entry => SORT_COMPARATORS[entry.key]);

  const sortedTasks = filtered
    .slice()
    .sort((a, b) => {
      if (activeSorts.length > 0) {
        for (const entry of activeSorts) {
          const comparator = SORT_COMPARATORS[entry.key];
          if (!comparator) continue;
          const result = comparator(a, b);
          if (result !== 0) {
            return entry.direction === 'asc' ? result : -result;
          }
        }
      }
      return defaultListComparator(a, b, statusOrder);
    });

  const createTaskRow = (task, depth) => {
    const tr = document.createElement('tr');
    tr.dataset.no = String(task.No || '');
    tr.dataset.kanbanId = String(task.__kanban_id || '');
    tr.addEventListener('dblclick', () => openEdit(task.No));

    const d = typeof depth === 'number' ? depth : 0;
    const hasChildren = TASKS.some(t => String(t.__parent_id ?? '').trim() === String(task.__kanban_id ?? '').trim());
    const isExpanded = TREE_EXPAND_STATE.get(String(task.__kanban_id ?? '').trim()) !== false;

    const noTd = document.createElement('td');
    applyColumnBaseStyles(noTd, 'no');
    noTd.textContent = task.No ? `#${task.No}` : '';
    tr.appendChild(noTd);

    // タスク名列（ツリーインデント付き）
    const titleTd = document.createElement('td');
    applyColumnBaseStyles(titleTd, 'task');
    titleTd.classList.add('task-cell', 'col-task');
    const titleWrap = document.createElement('div');
    titleWrap.style.display = 'flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.paddingLeft = `${d * 24}px`;
    titleWrap.style.gap = '4px';

    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle' + (isExpanded ? ' expanded' : '');
      toggle.textContent = '\u25B6';
      toggle.style.cursor = 'pointer';
      toggle.style.userSelect = 'none';
      toggle.style.width = '18px';
      toggle.style.display = 'inline-block';
      toggle.style.textAlign = 'center';
      toggle.style.color = 'var(--muted, #9ca3af)';
      toggle.style.transition = 'transform 0.15s';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = String(task.__kanban_id ?? '').trim();
        const currentlyExpanded = TREE_EXPAND_STATE.get(id) !== false;
        TREE_EXPAND_STATE.set(id, !currentlyExpanded);
        renderList();
      });
      titleWrap.appendChild(toggle);
    } else if (d > 0) {
      const spacer = document.createElement('span');
      spacer.style.width = '18px';
      spacer.style.display = 'inline-block';
      titleWrap.appendChild(spacer);
    }

    const titleText = document.createElement('span');
    titleText.textContent = task.タスク || '(無題)';
    titleWrap.appendChild(titleText);
    titleTd.appendChild(titleWrap);
    tr.appendChild(titleTd);

    // 親タスク名列
    const parentTd = document.createElement('td');
    applyColumnBaseStyles(parentTd, 'parent');
    if (task.__parent_id) {
      const parentTask = TASKS.find(t => String(t.__kanban_id ?? '').trim() === task.__parent_id);
      if (parentTask) {
        const pill = document.createElement('span');
        pill.className = 'parent-pill';
        pill.textContent = parentTask.タスク || '(無題)';
        parentTd.appendChild(pill);
      }
    }
    tr.appendChild(parentTd);

    const statusTd = document.createElement('td');
    applyColumnBaseStyles(statusTd, 'status');
    const statusPill = document.createElement('span');
    statusPill.className = 'status-pill';
    const statusLabel = normalizeStatusLabel(task.ステータス);
    statusPill.textContent = statusLabel;
    const statusClass = STATUS_CLASS_MAP.get(statusLabel);
    if (statusClass) {
      statusPill.classList.add(statusClass);
    }
    statusTd.appendChild(statusPill);
    tr.appendChild(statusTd);

    const assigneeTd = document.createElement('td');
    applyColumnBaseStyles(assigneeTd, 'assignee');
    assigneeTd.textContent = (task.担当者 || '').trim();
    tr.appendChild(assigneeTd);

    const priorityTd = document.createElement('td');
    applyColumnBaseStyles(priorityTd, 'priority');
    if (task.優先度 !== undefined && task.優先度 !== null && String(task.優先度).trim() !== '') {
      const pill = document.createElement('span');
      pill.className = 'priority-pill';
      pill.textContent = `優先度: ${task.優先度}`;
      const priorityLevel = getPriorityLevel(task.優先度);
      if (priorityLevel && priorityLevel !== 'unset' && priorityLevel !== 'custom') {
        pill.classList.add(`priority-pill--${priorityLevel}`);
      }
      priorityTd.appendChild(pill);
    }
    tr.appendChild(priorityTd);

    const dueTd = document.createElement('td');
    applyColumnBaseStyles(dueTd, 'due');
    if (task.期限) {
      const due = document.createElement('span');
      due.className = 'due-badge';
      let label = task.期限;
      const state = getDueState(task);
      if (state) {
        if (state.level === 'overdue') due.classList.add('due-overdue');
        if (state.level === 'warning') due.classList.add('due-warning');
        label += `（${state.label}）`;
      }
      due.textContent = label;
      dueTd.appendChild(due);
    }
    tr.appendChild(dueTd);

    const notesTd = document.createElement('td');
    applyColumnBaseStyles(notesTd, 'notes');
    notesTd.classList.add('notes-cell', 'col-notes');
    notesTd.textContent = task.備考 || '';
    tr.appendChild(notesTd);

    return { tr, hasChildren, isExpanded, kanbanId: String(task.__kanban_id ?? '').trim() };
  };

  // ツリー構造で再帰的に描画
  const renderTreeNodes = (parentId, depth) => {
    const children = sortedTasks.filter(t => {
      const pid = String(t.__parent_id ?? '').trim();
      return pid === parentId;
    });
    children.forEach(task => {
      const { tr, hasChildren, isExpanded, kanbanId } = createTaskRow(task, depth);
      tbody.appendChild(tr);
      if (hasChildren && isExpanded) {
        renderTreeNodes(kanbanId, depth + 1);
      }
    });
  };

  // ルートタスク（__parent_idが空）を描画し、子を再帰的に描画
  const rootTasks = sortedTasks.filter(t => !String(t.__parent_id ?? '').trim());
  rootTasks.forEach(task => {
    const { tr, hasChildren, isExpanded, kanbanId } = createTaskRow(task, 0);
    tbody.appendChild(tr);
    if (hasChildren && isExpanded) {
      renderTreeNodes(kanbanId, 1);
    }
  });
  // 親が存在しない孤立子タスクも表示
  const orphanTasks = sortedTasks.filter(t => {
    const pid = String(t.__parent_id ?? '').trim();
    if (!pid) return false;
    return !sortedTasks.some(p => String(p.__kanban_id ?? '').trim() === pid);
  });
  orphanTasks.forEach(task => {
    const { tr } = createTaskRow(task, 0);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  updateHorizontalScrollbar(table);
  updateHeaderDueSummary(filtered);
}


function buildAssigneeWorkload(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  workloadSummary?.update(list, {
    total: list.length,
    overall: Array.isArray(TASKS) ? TASKS.length : list.length,
  });
}


function handleSortToggle(columnKey) {
  const column = COLUMN_CONFIG_BY_KEY.get(columnKey);
  if (!column || !column.sortable) return;

  const idx = SORT_STATE.findIndex(entry => entry.key === columnKey);
  const cycle = columnKey === 'due' ? ['desc', 'asc'] : ['asc', 'desc'];

  if (idx === -1) {
    SORT_STATE.push({ key: columnKey, direction: cycle[0] });
  } else {
    const current = SORT_STATE[idx].direction;
    const position = cycle.indexOf(current);
    if (position >= 0 && position < cycle.length - 1) {
      SORT_STATE[idx].direction = cycle[position + 1];
    } else {
      SORT_STATE.splice(idx, 1);
    }
  }

  renderList();
}

function applySortHeaderState(thead) {
  if (!thead) return;
  const stateMap = new Map();
  SORT_STATE.forEach((entry, idx) => {
    stateMap.set(entry.key, { direction: entry.direction, order: idx + 1 });
  });

  thead.querySelectorAll('th[data-column-key]').forEach(th => {
    const key = th.dataset.columnKey;
    const info = stateMap.get(key);
    if (info) {
      th.dataset.sortDirection = info.direction;
      th.dataset.sortOrder = String(info.order);
      th.setAttribute('aria-sort', info.direction === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('data-sort-direction');
      th.removeAttribute('data-sort-order');
      th.setAttribute('aria-sort', 'none');
    }
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
  ['高', 0],
  ['High', 0],
  ['中', 1],
  ['Medium', 1],
  ['低', 2],
  ['Low', 2],
  ['通常', 3],
  ['Normal', 3],
  ['後回し', 4],
  ['Low Priority', 4],
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
        renderList();
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
      renderList();
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
      renderList();
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

window.addEventListener('resize', scheduleHorizontalScrollbarUpdate);
