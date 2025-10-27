/* eslint-disable no-console */
(function (global) {
  'use strict';

  const PRIORITY_DEFAULT_OPTIONS = ['高', '中', '低'];
  const DEFAULT_STATUSES = ['未着手', '進行中', '完了', '保留'];
  const UNSET_STATUS_LABEL = 'ステータス未設定';

  function ready(fn) {
    if (document.readyState !== 'loading') {
      try {
        fn();
      } catch (err) {
        console.error('[kanban] ready callback failed', err);
      }
      return;
    }
    document.addEventListener('DOMContentLoaded', () => {
      try {
        fn();
      } catch (err) {
        console.error('[kanban] ready callback failed', err);
      }
    }, { once: true });
  }

  function createMockApi() {
    const baseStatuses = ['未着手', '進行中', '完了', '保留'];
    const statusSet = new Set(baseStatuses);
    const pad = (n) => String(n).padStart(2, '0');
    const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const today = new Date();
    const majorCategories = ['プロジェクトA', 'プロジェクトB', 'プロジェクトC'];
    const minorCategories = ['企画', '設計', '実装', '検証'];
    const sampleTasks = Array.from({ length: 8 }).map((_, idx) => {
      const due = new Date(today);
      due.setDate(today.getDate() + idx - 2);
      const status = baseStatuses[idx % baseStatuses.length];
      statusSet.add(status);
      const major = majorCategories[idx % majorCategories.length];
      const minor = minorCategories[idx % minorCategories.length];
      return {
        ステータス: status,
        大分類: major,
        中分類: minor,
        タスク: `サンプルタスク ${idx + 1}`,
        担当者: ['田中', '佐藤', '鈴木', '高橋'][idx % 4],
        優先度: ['高', '中', '低'][idx % 3],
        期限: toISO(due),
        備考: idx % 2 === 0 ? 'モックデータ' : ''
      };
    });
    const tasks = [...sampleTasks];
    let validations = {
      'ステータス': Array.from(statusSet),
      '大分類': Array.from(new Set(majorCategories)),
      '中分類': Array.from(new Set(minorCategories)),
      '優先度': [...PRIORITY_DEFAULT_OPTIONS]
    };

    const cloneTask = (task) => ({ ...task });

    const sanitizeStatus = (status) => {
      const text = String(status ?? '').trim();
      if (text) return text;
      return baseStatuses[0];
    };

    const toIsoDate = (value) => {
      if (!value) return '';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return '';
      return toISO(parsed);
    };

    const normalizePriority = (value) => {
      if (value === null || value === undefined) return '';
      const text = String(value).trim();
      return text;
    };

    const normalizeTask = (payload) => {
      const status = sanitizeStatus(payload?.ステータス);
      statusSet.add(status);

      const major = String(payload?.大分類 ?? '').trim();
      const minor = String(payload?.中分類 ?? '').trim();

      const title = String(payload?.タスク ?? '').trim();
      if (!title) {
        throw new Error('タスクは必須です');
      }

      return {
        ステータス: status,
        大分類: major,
        中分類: minor,
        タスク: title,
        担当者: String(payload?.担当者 ?? '').trim(),
        優先度: normalizePriority(payload?.優先度),
        期限: toIsoDate(payload?.期限),
        備考: String(payload?.備考 ?? '')
      };
    };

    const withSequentialNo = () => tasks.map((task, idx) => ({ ...cloneTask(task), No: idx + 1 }));

    const locateTask = (no) => {
      const idx = Number(no) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= tasks.length) {
        return null;
      }
      return { index: idx, record: tasks[idx] };
    };

    const updateValidations = (payload) => {
      const withFallbacks = (source) => {
        const merged = { ...source };
        if (!Array.isArray(merged['ステータス']) || merged['ステータス'].length === 0) {
          merged['ステータス'] = Array.from(statusSet);
        }
        if (!Array.isArray(merged['優先度']) || merged['優先度'].length === 0) {
          merged['優先度'] = [...PRIORITY_DEFAULT_OPTIONS];
        }
        return merged;
      };

      if (!payload || typeof payload !== 'object') {
        validations = withFallbacks({});
        return validations;
      }
      const cleaned = {};
      Object.keys(payload).forEach(key => {
        const raw = Array.isArray(payload[key]) ? payload[key] : [];
        const seen = new Set();
        const values = [];
        raw.forEach(v => {
          const text = String(v ?? '').trim();
          if (!text || seen.has(text)) return;
          seen.add(text);
          values.push(text);
        });
        if (values.length > 0) cleaned[key] = values;
      });
      validations = withFallbacks(cleaned);
      if (Array.isArray(validations['ステータス'])) {
        validations['ステータス'].forEach(v => statusSet.add(v));
      }
      return validations;
    };

    return {
      async get_tasks() {
        return withSequentialNo();
      },
      async get_statuses() {
        return Array.from(statusSet);
      },
      async get_validations() {
        return { ...validations };
      },
      async update_validations(payload) {
        const updated = updateValidations(payload);
        return { ok: true, validations: { ...updated }, statuses: Array.from(statusSet) };
      },
      async add_task(payload) {
        const record = normalizeTask(payload);
        tasks.push(record);
        return { ...cloneTask(record), No: tasks.length };
      },
      async update_task(no, payload) {
        const located = locateTask(no);
        if (!located) throw new Error('指定したタスクが見つかりません');
        const updated = normalizeTask({ ...located.record, ...payload });
        tasks[located.index] = updated;
        return { ...cloneTask(updated), No: located.index + 1 };
      },
      async delete_task(no) {
        const located = locateTask(no);
        if (!located) return false;
        tasks.splice(located.index, 1);
        return true;
      },
      async move_task(no, status) {
        return this.update_task(no, { ステータス: status });
      },
      async save_excel() {
        return 'mock://task.xlsx';
      },
      async reload_from_excel() {
        return {
          ok: true,
          tasks: withSequentialNo(),
          statuses: Array.from(statusSet),
          validations: { ...validations }
        };
      }
    };
  }

  function sanitizeTaskRecord(task, fallbackIndex = 0) {
    if (!task || typeof task !== 'object') return null;
    const title = String(task.タスク ?? '').trim();
    if (!title) return null;
    const sanitized = { ...task, タスク: title };
    const noValue = sanitized.No;
    const noText = noValue === null || noValue === undefined ? '' : String(noValue).trim();
    if (!noText) {
      sanitized.No = fallbackIndex + 1;
    }
    return sanitized;
  }

  function sanitizeTaskList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const result = [];
    rawList.forEach(item => {
      const sanitized = sanitizeTaskRecord(item, result.length);
      if (sanitized) {
        result.push(sanitized);
      }
    });
    return result;
  }

  function normalizeStatePayload(payload) {
    if (!payload) return {};
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload) || {};
      } catch (err) {
        console.warn('[kanban] failed to parse payload string', err);
        return {};
      }
    }
    if (typeof payload === 'object') return payload;
    return {};
  }

  function normalizeStatusLabel(value) {
    const text = String(value ?? '').trim();
    return text || UNSET_STATUS_LABEL;
  }

  function denormalizeStatusLabel(value) {
    const text = String(value ?? '').trim();
    return text === UNSET_STATUS_LABEL ? '' : text;
  }

  function normalizeValidationValues(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const values = [];
    rawList.forEach(v => {
      const text = String(v ?? '').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      values.push(text);
    });
    return values;
  }

  function createPriorityHelper({ getValidations, defaultOptions = PRIORITY_DEFAULT_OPTIONS } = {}) {
    if (typeof getValidations !== 'function') {
      throw new Error('createPriorityHelper requires getValidations function');
    }

    const getOptions = () => {
      const source = getValidations() || {};
      const base = Array.isArray(source['優先度']) && source['優先度'].length > 0
        ? source['優先度']
        : defaultOptions;
      const seen = new Set();
      const options = [];
      base.forEach((value) => {
        const text = String(value ?? '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        options.push(text);
      });
      if (options.length === 0) {
        defaultOptions.forEach((value) => {
          if (!seen.has(value)) {
            seen.add(value);
            options.push(value);
          }
        });
      }
      return options;
    };

    const getDefaultValue = () => {
      const options = getOptions();
      if (options.includes('中')) return '中';
      return options[0] || '';
    };

    const applyOptions = (selectEl, currentValue, preferDefault = false) => {
      if (!selectEl) return;
      const normalized = currentValue === null || currentValue === undefined
        ? ''
        : String(currentValue).trim();
      const options = getOptions();
      const fragments = [];
      const addOption = (value, label = value) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        fragments.push(opt);
      };

      if (!normalized && !preferDefault) {
        addOption('', '（未設定）');
      }
      options.forEach(value => addOption(value));
      if (normalized && !options.includes(normalized)) {
        addOption(normalized);
      }

      selectEl.innerHTML = '';
      fragments.forEach(opt => selectEl.appendChild(opt));

      const values = Array.from(selectEl.options).map(opt => opt.value);
      let selection = normalized;
      if (!selection || !values.includes(selection)) {
        if (preferDefault) {
          selection = getDefaultValue();
        } else if (values.includes('')) {
          selection = '';
        } else {
          selection = getDefaultValue();
        }
      }
      if (!values.includes(selection)) {
        selection = values[0] || '';
      }
      selectEl.value = selection;
    };

    return {
      getOptions,
      getDefaultValue,
      applyOptions,
    };
  }

  function setupRuntime({ onInit, onRealtimeUpdate, onApiChanged, mockApiFactory } = {}) {
    const state = {
      api: null,
      runMode: 'mock',
    };

    const getMockApi = () => (typeof mockApiFactory === 'function' ? mockApiFactory() : createMockApi());

    const assignApi = (nextApi, runMode) => {
      if (!nextApi) return;
      state.api = nextApi;
      state.runMode = runMode;
      if (typeof onApiChanged === 'function') {
        try {
          onApiChanged({ api: state.api, runMode: state.runMode });
        } catch (err) {
          console.error('[kanban] onApiChanged callback failed', err);
        }
      }
      if (typeof onInit === 'function') {
        Promise.resolve(onInit({ api: state.api, runMode: state.runMode, force: true }))
          .catch(err => {
            console.error('[kanban] initialization failed', err);
          });
      }
    };

    global.addEventListener('pywebviewready', () => {
      const pyApi = global.pywebview?.api;
      if (pyApi) {
        assignApi(pyApi, 'pywebview');
      }
    });

    ready(() => {
      const pyApi = global.pywebview?.api;
      if (pyApi) {
        assignApi(pyApi, 'pywebview');
      } else {
        assignApi(getMockApi(), 'mock');
      }
    });

    global.__kanban_receive_update = (payload) => {
      if (typeof onRealtimeUpdate !== 'function') return;
      Promise.resolve(onRealtimeUpdate(payload)).catch(err => {
        console.error('[kanban] failed to apply pushed payload', err);
      });
    };

    return {
      get api() {
        return state.api;
      },
      get runMode() {
        return state.runMode;
      }
    };
  }

  global.TaskAppCommon = {
    createMockApi,
    ready,
    sanitizeTaskRecord,
    sanitizeTaskList,
    normalizeStatePayload,
    normalizeStatusLabel,
    denormalizeStatusLabel,
    normalizeValidationValues,
    createPriorityHelper,
    setupRuntime,
    PRIORITY_DEFAULT_OPTIONS,
    DEFAULT_STATUSES,
    UNSET_STATUS_LABEL,
  };
}(window));
