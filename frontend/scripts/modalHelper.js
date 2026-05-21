(function (global) {
  'use strict';

  function createTaskModal({ apiAccessor, getDataRefs, onAfterSave } = {}) {
    const resolveApi = () => {
      try { return apiAccessor(); } catch (_) { return {}; }
    };

    let CURRENT_EDIT = null;

    function openCreate(defaults = {}) {
      CURRENT_EDIT = null;
      const { statuses, validations, priorityHelper } = getDataRefs();
      openModal({
        No: '',
        'ステータス': statuses && statuses[0] || '未着手',
        '大分類': defaults.major !== undefined ? (defaults.major || '') : '',
        '中分類': defaults.minor !== undefined ? (defaults.minor || '') : '',
        'タスク': '',
        '担当者': '',
        '優先度': priorityHelper ? priorityHelper.getDefaultValue() : '中',
        '期限': '',
        '備考': ''
      }, { mode: 'create' });
    }

    function openEdit(no) {
      const { tasks } = getDataRefs();
      const t = tasks.find(x => x.No === no);
      if (!t) return;
      CURRENT_EDIT = no;
      openModal(t, { mode: 'edit' });
    }

    function closeModal() {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openModal(task, { mode }) {
      const modal = document.getElementById('modal');
      if (!modal) return;
      const { tasks, statuses, validations, priorityHelper } = getDataRefs();
      const denormalizeStatusLabel = window.TaskValidation?.denormalizeStatusLabel || (v => v);
      const normalizeStatusLabel = window.TaskValidation?.normalizeStatusLabel || (v => v);
      const UNSET_STATUS_LABEL = window.TaskValidation?.UNSET_STATUS_LABEL || 'ステータス未設定';
      const sanitizeTaskRecord = window.TaskAppCommon?.sanitizeTaskRecord || (t => t);
      const sanitizeTaskList = window.TaskAppCommon?.sanitizeTaskList || (l => l);
      const collectCategoryOptions = window.TaskAppCommon?.collectCategoryOptions;
      const uniqAssignees = window.TaskAppCommon?.uniqAssignees;

      const title = document.getElementById('modal-title');
      const fno = document.getElementById('f-no');
      const fstat = document.getElementById('f-status');
      const fmajor = document.getElementById('f-major');
      const fminor = document.getElementById('f-minor');
      const fttl = document.getElementById('f-title');
      const fwho = document.getElementById('f-assignee');
      const fprio = document.getElementById('f-priority');
      const fdue = document.getElementById('f-due');
      const fnote = document.getElementById('f-notes');
      const btnDelete = document.getElementById('btn-delete');

      title.textContent = mode === 'create' ? 'タスク追加' : 'タスク編集';

      const statusList = Array.isArray(statuses) ? statuses : [];
      const seen = new Set();
      fstat.innerHTML = '';
      statusList.forEach(status => {
        const normalized = normalizeStatusLabel(status);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        const opt = document.createElement('option');
        opt.value = normalized;
        opt.textContent = normalized;
        fstat.appendChild(opt);
      });
      if (!seen.has(UNSET_STATUS_LABEL)) {
        const opt = document.createElement('option');
        opt.value = UNSET_STATUS_LABEL;
        opt.textContent = UNSET_STATUS_LABEL;
        fstat.appendChild(opt);
      }

      fno.value = task.No ?? '';
      fstat.value = normalizeStatusLabel(task['ステータス']);
      if (!Array.from(fstat.options).some(opt => opt.value === fstat.value)) {
        const opt = document.createElement('option');
        opt.value = fstat.value;
        opt.textContent = fstat.value;
        fstat.appendChild(opt);
      }
      fstat.value = normalizeStatusLabel(task['ステータス']);

      if (fmajor) fmajor.value = task['大分類'] || '';
      if (fminor) fminor.value = task['中分類'] || '';

      if (fmajor && fminor && typeof collectCategoryOptions === 'function') {
        setupCategorySuggestions(fmajor, fminor, tasks, validations, collectCategoryOptions);
      }

      fttl.value = task['タスク'] || '';
      fwho.value = task['担当者'] || '';

      if (fwho && typeof uniqAssignees === 'function') {
        setupAssigneeSuggestions(fwho, tasks, uniqAssignees);
      }

      if (fprio && priorityHelper) {
        priorityHelper.applyOptions(fprio, task['優先度'], mode === 'create');
      }

      fdue.value = (task['期限'] || '').slice(0, 10);
      fnote.value = task['備考'] || '';

      btnDelete.style.display = mode === 'edit' ? 'inline-flex' : 'none';

      document.getElementById('btn-close').onclick = closeModal;
      document.getElementById('btn-cancel').onclick = closeModal;

      btnDelete.onclick = async () => {
        if (!CURRENT_EDIT) return;
        if (!confirm('削除しますか？')) return;
        try {
          const api = resolveApi();
          const ok = await api.delete_task(CURRENT_EDIT);
          if (ok) {
            if (typeof api.get_tasks === 'function') {
              getDataRefs().tasks = sanitizeTaskList(await api.get_tasks());
            } else {
              const remaining = tasks
                .filter(x => x.No !== CURRENT_EDIT)
                .map((record, idx) => ({ ...record, No: idx + 1 }));
              getDataRefs().tasks = sanitizeTaskList(remaining);
            }
            CURRENT_EDIT = null;
            closeModal();
            if (typeof onAfterSave === 'function') {
              onAfterSave();
            }
          } else {
            alert('削除できませんでした');
          }
        } catch (err) {
          alert('削除に失敗: ' + (err?.message || err));
        }
      };

      const form = document.getElementById('task-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const payload = {
          'ステータス': denormalizeStatusLabel(fstat.value),
          '大分類': fmajor ? fmajor.value.trim() : '',
          '中分類': fminor ? fminor.value.trim() : '',
          'タスク': fttl.value.trim(),
          '担当者': fwho.value.trim(),
          '優先度': (fprio.value ?? '').trim(),
          '期限': fdue.value ? fdue.value : '',
          '備考': fnote.value
        };

        if (!payload['タスク']) {
          alert('タスクを入力してください。');
          fttl.focus();
          return;
        }

        try {
          const api = resolveApi();
          if (mode === 'create') {
            const created = await api.add_task(payload);
            const sanitized = sanitizeTaskRecord(created, tasks.length);
            if (sanitized) {
              tasks.push(sanitized);
            }
          } else {
            const no = CURRENT_EDIT;
            const updated = await api.update_task(no, payload);
            const i = tasks.findIndex(x => x.No === no);
            if (i >= 0) {
              const sanitized = sanitizeTaskRecord(updated, i);
              if (sanitized) {
                tasks[i] = sanitized;
              } else {
                tasks.splice(i, 1);
              }
            }
          }
          CURRENT_EDIT = null;
          closeModal();
          if (typeof onAfterSave === 'function') {
            onAfterSave();
          }
        } catch (err) {
          alert('保存に失敗: ' + (err?.message || err));
        }
      };

      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }

    return {
      openCreate,
      openEdit,
      closeModal,
      get currentEdit() { return CURRENT_EDIT; },
      set currentEdit(v) { CURRENT_EDIT = v; },
    };
  }

  function setupCategorySuggestions(fmajor, fminor, tasks, validations, collectCategoryOptions) {
    const majorListEl = document.getElementById('modal-major-list');
    const minorListEl = document.getElementById('modal-minor-list');
    if (!majorListEl && !minorListEl) return;

    const { majorList, minorMap, allMinors } = collectCategoryOptions(tasks, validations);

    const fillOptions = (datalist, values) => {
      if (!datalist) return;
      datalist.innerHTML = '';
      if (!Array.isArray(values)) return;
      const seen = new Set();
      values.forEach(value => {
        const text = String(value ?? '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        const opt = document.createElement('option');
        opt.value = text;
        datalist.appendChild(opt);
      });
    };

    fillOptions(majorListEl, majorList);

    const fallbackMinors = Array.isArray(allMinors) ? allMinors : [];
    const updateMinorOptions = () => {
      if (!minorListEl) return;
      const majorValue = String(fmajor?.value ?? '').trim();
      let candidates = fallbackMinors;
      if (majorValue && minorMap.has(majorValue)) {
        const list = minorMap.get(majorValue) || [];
        if (Array.isArray(list) && list.length > 0) {
          candidates = list;
        }
      }
      fillOptions(minorListEl, candidates);
    };

    updateMinorOptions();

    if (fmajor && minorListEl) {
      if (typeof fmajor.__minorListHandler === 'function') {
        fmajor.removeEventListener('input', fmajor.__minorListHandler);
        fmajor.removeEventListener('change', fmajor.__minorListHandler);
      }
      const handler = () => updateMinorOptions();
      fmajor.__minorListHandler = handler;
      fmajor.addEventListener('input', handler);
      fmajor.addEventListener('change', handler);
    }

    if (fminor && minorListEl) {
      if (typeof fminor.__minorListRefresh === 'function') {
        fminor.removeEventListener('focus', fminor.__minorListRefresh);
      }
      const refresh = () => updateMinorOptions();
      fminor.__minorListRefresh = refresh;
      fminor.addEventListener('focus', refresh);
    }
  }

  function setupAssigneeSuggestions(fassignee, tasks, uniqAssignees) {
    const datalist = document.getElementById('modal-assignee-list');
    if (!fassignee || !datalist) return;

    const candidates = uniqAssignees(tasks);
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

  global.TaskModalHelper = {
    createTaskModal,
    setupCategorySuggestions,
    setupAssigneeSuggestions,
  };
}(window));
