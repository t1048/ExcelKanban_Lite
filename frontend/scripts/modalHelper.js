(function (global) {
  'use strict';

  function createTaskModal({ apiAccessor, getDataRefs, onAfterSave } = {}) {
    const resolveApi = () => {
      try { return apiAccessor(); } catch (_) { return {}; }
    };

    let CURRENT_EDIT = null;

    function openCreate(defaults = {}) {
      CURRENT_EDIT = null;
      const { statuses, priorityHelper } = getDataRefs();
      openModal({
        No: '',
        'ステータス': statuses && statuses[0] || '未着手',
        '__parent_id': defaults.parent_id || '',
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
      hideParentDropdown();
    }

    function openModal(task, { mode }) {
      const modal = document.getElementById('modal');
      if (!modal) return;
      const { tasks, statuses, priorityHelper } = getDataRefs();
      const denormalizeStatusLabel = window.TaskValidation?.denormalizeStatusLabel || (v => v);
      const normalizeStatusLabel = window.TaskValidation?.normalizeStatusLabel || (v => v);
      const UNSET_STATUS_LABEL = window.TaskValidation?.UNSET_STATUS_LABEL || 'ステータス未設定';
      const sanitizeTaskRecord = window.TaskAppCommon?.sanitizeTaskRecord || (t => t);
      const sanitizeTaskList = window.TaskAppCommon?.sanitizeTaskList || (l => l);
      const uniqAssignees = window.TaskAppCommon?.uniqAssignees;

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

      // 親タスク選択UI
      if (fparent && fparentHidden) {
        const currentParentId = task['__parent_id'] || '';
        fparentHidden.value = currentParentId;
        if (currentParentId) {
          const parentTask = tasks.find(t => String(t.__kanban_id ?? '').trim() === currentParentId);
          fparent.value = parentTask ? parentTask.タスク : currentParentId;
        } else {
          fparent.value = '';
        }
        setupParentTaskSelector(fparent, fparentHidden, tasks, task.__kanban_id || '');
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
        const currentTask = tasks.find(x => x.No === CURRENT_EDIT);
        const childCount = currentTask ? tasks.filter(t => String(t.__parent_id ?? '').trim() === String(currentTask.__kanban_id ?? '').trim()).length : 0;
        let confirmMsg = '削除しますか？';
        if (childCount > 0) {
          confirmMsg = `このタスクには ${childCount} 件の子タスクがあります。子タスクもすべて削除しますか？\n\nOK = すべて削除 / キャンセル = 削除中止`;
        }
        if (!confirm(confirmMsg)) return;
        try {
          const api = resolveApi();
          const ok = await api.delete_task(CURRENT_EDIT, true);
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

      btnAddChildTask.onclick = async () => {
        const payload = {
          'ステータス': denormalizeStatusLabel(fstat.value),
          '__parent_id': fparentHidden ? fparentHidden.value.trim() : '',
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
          let savedKanbanId = null;
          if (mode === 'create') {
            const created = await api.add_task(payload);
            const sanitized = sanitizeTaskRecord(created, tasks.length);
            if (sanitized) {
              tasks.push(sanitized);
              savedKanbanId = sanitized.__kanban_id || null;
            }
          } else {
            const no = CURRENT_EDIT;
            const updated = await api.update_task(no, payload);
            const i = tasks.findIndex(x => x.No === no);
            if (i >= 0) {
              const sanitized = sanitizeTaskRecord(updated, i);
              if (sanitized) {
                tasks[i] = sanitized;
                savedKanbanId = sanitized.__kanban_id || null;
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
          'ステータス': denormalizeStatusLabel(fstat.value),
          '__parent_id': fparentHidden ? fparentHidden.value.trim() : '',
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

  function setupParentTaskSelector(inputEl, hiddenEl, tasks, currentTaskId) {
    if (!inputEl || !hiddenEl) return;

    const buildTreeOptions = () => {
      const buildTaskTree = window.TaskAppCommon?.buildTaskTree;
      const flattenTree = window.TaskAppCommon?.flattenTree;
      const isAncestor = window.TaskAppCommon?.isAncestor;
      const list = Array.isArray(tasks) ? tasks : [];

      // 自分自身と子孫を除外
      const descendantIds = window.TaskAppCommon?.getDescendantIds(currentTaskId, list) || [];
      const excludeIds = new Set([currentTaskId, ...descendantIds]);

      let options = [{ label: '（親なし / ルート）', value: '', depth: 0, disabled: false }];

      if (typeof buildTaskTree === 'function' && typeof flattenTree === 'function') {
        const tree = buildTaskTree(list);
        const flat = flattenTree(tree, 0);
        flat.forEach(node => {
          const id = String(node.__kanban_id ?? '').trim();
          if (!id) return;
          const disabled = excludeIds.has(id);
          const indent = '　'.repeat(node._depth);
          options.push({
            label: `${indent}${node.タスク || '(無題)'}`,
            value: id,
            depth: node._depth,
            disabled,
          });
        });
      } else {
        list.forEach(t => {
          const id = String(t.__kanban_id ?? '').trim();
          if (!id) return;
          const disabled = excludeIds.has(id);
          options.push({
            label: t.タスク || '(無題)',
            value: id,
            depth: 0,
            disabled,
          });
        });
      }
      return options;
    };

    let dropdownEl = inputEl.parentElement.querySelector('.parent-search-dropdown');
    if (!dropdownEl) {
      dropdownEl = document.createElement('ul');
      dropdownEl.className = 'parent-search-dropdown';
      dropdownEl.style.display = 'none';
      inputEl.parentElement.style.position = 'relative';
      inputEl.parentElement.appendChild(dropdownEl);
    }

    let activeIndex = -1;
    let options = [];

    const renderOptions = (filter) => {
      const allOptions = buildTreeOptions();
      const filterText = String(filter ?? '').trim().toLowerCase();
      options = filterText
        ? allOptions.filter(opt => opt.label.toLowerCase().includes(filterText) || opt.value === '')
        : allOptions;

      dropdownEl.innerHTML = '';
      options.forEach((opt, idx) => {
        const li = document.createElement('li');
        li.textContent = opt.label;
        li.dataset.value = opt.value;
        li.dataset.index = String(idx);
        if (opt.disabled) {
          li.classList.add('disabled');
        } else {
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectOption(opt);
          });
        }
        dropdownEl.appendChild(li);
      });
      activeIndex = -1;
    };

    const selectOption = (opt) => {
      hiddenEl.value = opt.value;
      inputEl.value = opt.value === '' ? '' : opt.label.replace(/^　+/, '');
      hideParentDropdown();
    };

    const showDropdown = () => {
      renderOptions(inputEl.value);
      dropdownEl.style.display = 'block';
    };

    const hideParentDropdown = () => {
      dropdownEl.style.display = 'none';
      activeIndex = -1;
    };

    inputEl.addEventListener('focus', showDropdown);
    inputEl.addEventListener('input', () => {
      hiddenEl.value = '';
      showDropdown();
    });
    inputEl.addEventListener('keydown', (e) => {
      if (dropdownEl.style.display === 'none') return;
      const items = dropdownEl.querySelectorAll('li:not(.disabled)');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActiveItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveItem(items);
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < options.length) {
        e.preventDefault();
        const opt = options[activeIndex];
        if (!opt.disabled) selectOption(opt);
      } else if (e.key === 'Escape') {
        hideParentDropdown();
      }
    });
    inputEl.addEventListener('blur', () => {
      setTimeout(() => hideParentDropdown(), 150);
    });
  }

  function hideParentDropdown() {
    document.querySelectorAll('.parent-search-dropdown').forEach(el => {
      el.style.display = 'none';
    });
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

  function updateActiveItem(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('active', idx === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  global.TaskModalHelper = {
    createTaskModal,
    setupParentTaskSelector,
    setupAssigneeSuggestions,
  };
}(window));
