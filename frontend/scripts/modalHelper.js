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
      const task = {
        No: '',
        'ステータス': statuses && statuses[0] || '未着手',
        '__parent_id': defaults.parent_id || '',
        'タスク': '',
        '担当者': '',
        '優先度': priorityHelper ? priorityHelper.getDefaultValue() : '中',
        '期限': '',
        '備考': ''
      };
      openModal(task, { mode: 'create' });
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

    function renderChildTasks(containerId, currentTask, tasks, mode) {
      const listEl = document.getElementById(containerId);
      if (!listEl) return;

      const currentKanbanId = String(currentTask.__kanban_id ?? '').trim();

      listEl.innerHTML = '';

      if (mode === 'create' || !currentKanbanId) {
        const empty = document.createElement('div');
        empty.className = 'child-tasks-empty';
        empty.textContent = mode === 'create'
          ? '（保存後に子タスクを追加できます）'
          : '（子タスクはありません）';
        listEl.appendChild(empty);
        return;
      }

      const children = tasks.filter(t => String(t.__parent_id ?? '').trim() === currentKanbanId);

      if (children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'child-tasks-empty';
        empty.textContent = '（子タスクはありません）';
        listEl.appendChild(empty);
        return;
      }

      children.forEach(child => {
        const item = document.createElement('div');
        item.className = 'child-task-item';

        const arrow = document.createElement('span');
        arrow.className = 'child-task-arrow';
        arrow.textContent = '\u21B3';
        item.appendChild(arrow);

        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'child-task-link';
        link.textContent = child['タスク'] || '(無題)';
        link.addEventListener('click', () => {
          closeModal();
          setTimeout(() => openEdit(child.No), 50);
        });
        item.appendChild(link);

        const status = document.createElement('span');
        status.className = 'child-task-status';
        status.textContent = child['ステータス'] || '';
        item.appendChild(status);

        listEl.appendChild(item);
      });

      const completed = children.filter(c => {
        const s = String(c['ステータス'] ?? '').trim();
        return s === '完了' || s === '完了済み' || s === '完了済';
      }).length;

      const summary = document.createElement('div');
      summary.className = 'child-tasks-summary';
      summary.textContent = `${children.length}件の子タスク（${completed}件完了）`;
      listEl.appendChild(summary);
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

      // 親タスクリンク表示（ハイパーリンクで親の編集モーダルへ）
      function updateParentLinkDisplay() {
        const linkEl = document.getElementById('parent-link-display');
        if (!linkEl) return;
        const parentId = (fparentHidden?.value || '').trim();
        if (!parentId) {
          linkEl.replaceChildren();
          linkEl.style.display = 'none';
          return;
        }
        const parentTask = tasks.find(t => String(t.__kanban_id ?? '').trim() === parentId);
        const parentName = parentTask ? parentTask.タスク : parentId;
        linkEl.replaceChildren();
        const arrow = document.createElement('span');
        arrow.className = 'parent-link-arrow';
        arrow.textContent = '\u2192';
        const a = document.createElement('a');
        a.href = '#';
        a.tabIndex = 0;
        a.textContent = parentName;
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (parentTask) {
            closeModal();
            setTimeout(function () { openEdit(parentTask.No); }, 50);
          }
        });
        a.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && parentTask) {
            e.preventDefault();
            closeModal();
            setTimeout(function () { openEdit(parentTask.No); }, 50);
          }
        });
        linkEl.appendChild(arrow);
        linkEl.appendChild(a);
        linkEl.style.display = 'inline-flex';
      }
      if (fparent && fparent._taskModalParentLinkInputHandler) {
        fparent.removeEventListener('input', fparent._taskModalParentLinkInputHandler);
      }
      if (fparent) {
        fparent._taskModalParentLinkInputHandler = updateParentLinkDisplay;
        fparent.addEventListener('input', updateParentLinkDisplay);
      }
      updateParentLinkDisplay();

      // 子タスク表示
      renderChildTasks('child-tasks-list', task, tasks, mode);

      // 表示条件の整理（親タスク欄／子タスク欄の出し分け）
      const parentTaskRow = document.getElementById('parent-task-row');
      const childTaskRow = document.getElementById('child-tasks-row');
      const currentKanbanId = String(task.__kanban_id ?? '').trim();

      if (mode === 'create') {
        if (parentTaskRow) parentTaskRow.style.display = '';
        if (childTaskRow) childTaskRow.style.display = 'none';
      } else if (mode === 'edit') {
        const hasChildren = currentKanbanId && tasks.some(t =>
          String(t.__parent_id ?? '').trim() === currentKanbanId
        );
        const hasParent = !!task.__parent_id;

        if (hasChildren && !hasParent) {
          if (parentTaskRow) parentTaskRow.style.display = 'none';
          if (childTaskRow) childTaskRow.style.display = '';
        } else {
          if (parentTaskRow) parentTaskRow.style.display = '';
          // 子タスクは再帰的に追加できるよう、編集時は常に表示（0件でも「＋ 子タスクを追加」を出す）
          if (childTaskRow) childTaskRow.style.display = '';
        }
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
      btnAddChildTask.style.display = mode === 'edit' ? 'block' : 'none';

      document.getElementById('btn-close').onclick = closeModal;
      document.getElementById('btn-cancel').onclick = closeModal;

      const taskKanbanId = task['__kanban_id'] || '';

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

  function renderChildTasksInModal(containerId, currentTask, tasks, mode, onEditChild) {
    const listEl = document.getElementById(containerId);
    if (!listEl) return;

    const currentKanbanId = String(currentTask.__kanban_id ?? '').trim();

    listEl.innerHTML = '';

    if (mode === 'create' || !currentKanbanId) {
      const empty = document.createElement('div');
      empty.className = 'child-tasks-empty';
      empty.textContent = mode === 'create'
        ? '（保存後に子タスクを追加できます）'
        : '（子タスクはありません）';
      listEl.appendChild(empty);
      return;
    }

    const children = (Array.isArray(tasks) ? tasks : []).filter(t => String(t.__parent_id ?? '').trim() === currentKanbanId);

    if (children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'child-tasks-empty';
      empty.textContent = '（子タスクはありません）';
      listEl.appendChild(empty);
      return;
    }

    children.forEach(child => {
      const item = document.createElement('div');
      item.className = 'child-task-item';

      const arrow = document.createElement('span');
      arrow.className = 'child-task-arrow';
      arrow.textContent = '\u21B3';
      item.appendChild(arrow);

      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'child-task-link';
      link.textContent = child['タスク'] || '(無題)';
      link.addEventListener('click', () => {
        if (typeof onEditChild === 'function') {
          onEditChild(child.No);
        }
      });
      item.appendChild(link);

      const status = document.createElement('span');
      status.className = 'child-task-status';
      status.textContent = child['ステータス'] || '';
      item.appendChild(status);

      listEl.appendChild(item);
    });

    const completed = children.filter(c => {
      const s = String(c['ステータス'] ?? '').trim();
      return s === '完了' || s === '完了済み' || s === '完了済';
    }).length;

    const summary = document.createElement('div');
    summary.className = 'child-tasks-summary';
    summary.textContent = `${children.length}件の子タスク（${completed}件完了）`;
    listEl.appendChild(summary);
  }

  function setupParentTaskSelector(inputEl, hiddenEl, tasks, currentTaskId) {
    if (!inputEl || !hiddenEl) return;

    const buildTreeOptions = () => {
      const buildTaskTree = window.TaskAppCommon?.buildTaskTree;
      const flattenTree = window.TaskAppCommon?.flattenTree;
      const list = Array.isArray(tasks) ? tasks : [];

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
          const indent = '\u3000'.repeat(node._depth);
          const statusText = node['ステータス'] ? `[${node['ステータス']}] ` : '';
          options.push({
            label: `${indent}${statusText}${node.タスク || '(無題)'}`,
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
          const statusText = t['ステータス'] ? `[${t['ステータス']}] ` : '';
          options.push({
            label: `${statusText}${t.タスク || '(無題)'}`,
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
      inputEl.value = opt.value === '' ? '' : opt.label.replace(/^\u3000+/, '');
      hideParentDropdown();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const showDropdown = () => {
      renderOptions(inputEl.value);
      dropdownEl.style.display = 'block';
    };

    if (inputEl._taskModalSelectorFocusHandler) {
      inputEl.removeEventListener('focus', inputEl._taskModalSelectorFocusHandler);
    }
    if (inputEl._taskModalSelectorInputHandler) {
      inputEl.removeEventListener('input', inputEl._taskModalSelectorInputHandler);
    }
    if (inputEl._taskModalSelectorKeydownHandler) {
      inputEl.removeEventListener('keydown', inputEl._taskModalSelectorKeydownHandler);
    }
    if (inputEl._taskModalSelectorBlurHandler) {
      inputEl.removeEventListener('blur', inputEl._taskModalSelectorBlurHandler);
    }

    const handleFocus = showDropdown;
    const handleInput = () => {
      hiddenEl.value = '';
      showDropdown();
    };
    const handleKeydown = (e) => {
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
    };
    const handleBlur = () => {
      setTimeout(() => hideParentDropdown(), 150);
    };

    inputEl._taskModalSelectorFocusHandler = handleFocus;
    inputEl._taskModalSelectorInputHandler = handleInput;
    inputEl._taskModalSelectorKeydownHandler = handleKeydown;
    inputEl._taskModalSelectorBlurHandler = handleBlur;

    inputEl.addEventListener('focus', handleFocus);
    inputEl.addEventListener('input', handleInput);
    inputEl.addEventListener('keydown', handleKeydown);
    inputEl.addEventListener('blur', handleBlur);
  }

  function hideParentDropdown() {
    document.querySelectorAll('.parent-search-dropdown').forEach(el => {
      el.style.display = 'none';
    });
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
    setupAssigneeSuggestions,
    setupParentTaskSelector,
    hideParentDropdown,
    renderChildTasksInModal,
  };
}(window));
