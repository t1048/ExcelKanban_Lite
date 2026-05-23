# 改造仕様書: 大分類・中分類 → 再帰的親子タスク階層

## 1. 概要

既存の固定2階層カテゴリ（大分類・中分類）を廃止し、タスクが任意の深さで親子関係を持てる再帰的ツリー構造へ変更する。親子関係は隠しExcel列 `__parent_id` で管理。

## 2. データモデル変更

### 2.1 Excel列定義

**削除:** `大分類`, `中分類`

**追加:** `__parent_id`（隠し列）

**新列構成（constants.py）:**

```python
TASK_COLUMNS = ["ステータス", "タスク", "担当者", "優先度", "期限", "備考"]
HIDDEN_META_COLUMNS = ["__kanban_id", "__parent_id"]
```

### 2.2 タスクオブジェクト

| フィールド | キー | 型 | 備考 |
|-----------|------|-----|------|
| 行番号 | `No` | int | 計算値 |
| ステータス | `ステータス` | string | |
| タスク名 | `タスク` | string | 必須 |
| 担当者 | `担当者` | string | |
| 優先度 | `優先度` | string | |
| 期限 | `期限` | date | YYYY-MM-DD |
| 備考 | `備考` | string | |
| Kanban ID | `__kanban_id` | string(UUID) | 隠し列 |
| **親ID** | **`__parent_id`** | **string \| null** | **隠し列、新規** |

## 3. データ移行

### 3.1 移行トリガー
- Excelファイル読み込み時、`大分類` または `中分類` 列が存在し、かつ `__parent_id` 列が存在しない場合に自動移行
- 移行前にバックアップを自動作成

### 3.2 移行ロジック
1. 各タスクの `大分類` 値でグループ化
2. 同名の `大分類` 値ごとに親タスクを自動作成（`タスク` = 大分類名、`ステータス` = "未着手"）
3. 元のタスクの `__parent_id` に親タスクの `__kanban_id` を設定
4. `中分類` 値は `備考` の先頭に `[旧中分類: xxx]` として退避
5. 移行後、`大分類`・`中分類` 列を削除して保存

## 4. バックエンド改造

### 4.1 `backend/constants.py`
- `TASK_COLUMNS` から `大分類`/`中分類` を削除
- `HIDDEN_META_COLUMNS` に `PARENT_ID_COLUMN` を追加

### 4.2 `backend/task_store.py`

#### 追加メソッド

| メソッド | 説明 |
|---------|------|
| `_migrate_categories_to_hierarchy()` | 大分類・中分類を親子階層に移行 |
| `_check_circular_ref()` | 循環参照の検出 |
| `get_children(task_id)` | 直接の子タスク一覧 |
| `get_descendant_ids(task_id)` | 全子孫IDを再帰的に収集 |
| `get_ancestor_ids(task_id)` | 全祖先IDを返す |
| `get_task_tree()` | ツリー構造(children配列付き)で返す |

#### 変更メソッド

| メソッド | 変更内容 |
|---------|---------|
| `add_task()` | `parent_id` パラメータ対応、循環参照チェック |
| `update_task()` | `__parent_id` 変更対応、循環参照チェック |
| `delete_task()` | `cascade` パラメータ追加。True時全子孫削除、False時子をルートに昇格 |
| `_format_row()` | `__parent_id` を出力に含める |
| `_ensure_meta_columns()` | `__parent_id` 列の自動追加 |

### 4.3 `backend/js_api.py`

#### 追加API

| メソッド | 説明 |
|---------|------|
| `get_task_tree()` | ツリー構造でタスクを返す |
| `get_task_children(task_id)` | 子タスク一覧を返す |
| `move_task_parent(no, parent_id)` | タスクの親を変更 |
| `delete_task(no, cascade)` | cascade指定付き削除 |

## 5. フロントエンド改造

### 5.1 `frontend/scripts/common.js`

#### 削除
- `collectCategoryOptions()` 関数

#### 追加ユーティリティ

| 関数 | 説明 |
|------|------|
| `buildTaskTree(tasks)` | フラット配列 → ツリー構造 |
| `flattenTree(nodes, depth)` | ツリー → フラット配列（インデント表示用） |
| `getDescendantIds(taskId, tasks)` | 全子孫IDを収集 |
| `getAncestorIds(taskId, tasks)` | 全祖先IDを収集 |
| `isAncestor(candidateId, targetId, tasks)` | 祖先判定（循環参照チェック用） |
| `getParentTask(taskId, tasks)` | 親タスクを取得 |
| `getChildCount(taskId, tasks)` | 子タスク数を取得 |

### 5.2 `frontend/scripts/index.js`（かんばんビュー）

- `collectCategoryOptions()` 削除
- `setupCategoryInputSuggestions()` 削除
- `renderCard()`: カテゴリバッジ → 親タスクラベル（`↳ 親: {名前}`）に変更
- `openCreate()`: `__parent_id` 初期化
- `openModal()`: 親タスク選択UI（検索＋ドロップダウン）に変更
- フラット表示: 全タスク（親子問わず）をステータス列に表示

### 5.3 `frontend/scripts/list.js`（一覧ビュー）

- `buildGroupedTaskList()` 削除（大分類→中分類のグループ化廃止）
- `createGroupRow()` 削除
- グループコンテキストメニュー削除
- `compareMajorValues()`, `compareMinorValues()` 削除
- **ツリー表示追加:**
  - イデント + ▶/▼ トグル矢印で階層表示
  - `TREE_EXPAND_STATE` Map で展開状態を管理
  - 親タスク列を追加（親タスク名をピル表示）
  - 親タスク名セルにツリーインデント付きで表示

### 5.4 `frontend/scripts/timeline.js`（タイムライン）
- `大分類`/`中分類` メタデータ表示 → 親タスク名表示に変更

### 5.5 `frontend/scripts/calendar.js`（カレンダー）
- `大分類`/`中分類` ラベル → 親タスク名ラベルに変更

### 5.6 `frontend/scripts/modalHelper.js`（共有モーダル）

#### 削除
- `setupCategorySuggestions()` 関数

#### 追加
- `setupParentTaskSelector()`: 検索＋ツリー選択ドロップダウン
  - タスク名でフィルタリング
  - ドロップダウンに階層表示（インデント付き）
  - 自分自身と子孫を選択不可（循環参照防止）
  - 「なし（ルートタスク）」オプション

### 5.7 `frontend/scripts/filter-ui.js`（フィルターバー）

#### 削除
- 大分類フィルター `<select id="flt-major">`
- 中分類フィルター `<select id="flt-minor">`
- `CATEGORY_FILTER_ALL`, `CATEGORY_FILTER_MINOR_ALL` 定数
- `collectCategoryOptions()` コピー
- フィルター状態の `category` キー

## 6. HTML改造

### 全4ページ共通

**削除:**
```html
<label>大分類</label>
<input type="text" id="f-major" list="modal-major-list">
<datalist id="modal-major-list"></datalist>
<label>中分類</label>
<input type="text" id="f-minor" list="modal-minor-list">
<datalist id="modal-minor-list"></datalist>
```

**追加:**
```html
<label>親タスク</label>
<input type="text" id="f-parent" placeholder="タスク名で検索..." autocomplete="off">
<input type="hidden" id="f-parent-hidden">
```

## 7. CSS改造

### `kanban.css`
- `.card-category`, `.badge-major`, `.badge-minor` 削除
- `.card-parent-label`, `.parent-link` 追加

### `list.css`
- `.group-major`, `.group-minor`, `.category-pill` 系削除
- `.parent-pill`, `.tree-toggle` 追加

## 8. 循環参照防止

### チェックタイミング
1. **モーダルの親選択UI**: 自分自身と子孫をドロップダウン候補から除外
2. **バックエンド `add_task()` / `update_task()`**: 保存前にチェック、検出時はエラー返却

## 9. 削除時の子タスク処理

### フロー
```
子タスクなし → 即時削除
子タスクあり → 確認ダイアログ
  ├─ OK → 全子孫を再帰的に削除
  └─ キャンセル → 削除中止
```

## 10. テスト

| No | テスト内容 | 結果 |
|----|----------|------|
| 1 | bootstrap_persists_ids | PASS |
| 2 | parent_id_column_exists | PASS |
| 3 | add_task_with_parent | PASS |
| 4 | circular_reference_prevention | PASS |
| 5 | cascade_delete | PASS |
| 6 | delete_without_cascade_promotes_children | PASS |
| 7 | get_task_tree | PASS |
| 8 | migration_from_categories | PASS |
| 9 | save_and_load_with_parent_id | PASS |
| 10 | parent_id_hidden_in_excel | PASS |

## 11. 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `backend/constants.py` | TASK_COLUMNSから大分類/中分類削除、PARENT_ID_COLUMN追加 |
| `backend/__init__.py` | PARENT_ID_COLUMNエクスポート追加 |
| `backend/backend.py` | PARENT_ID_COLUMNエクスポート追加 |
| `backend/task_store.py` | 移行ロジック、親子CRUD、循環参照チェック、ツリーAPI |
| `backend/js_api.py` | ツリーAPI、cascade削除対応 |
| `frontend/scripts/common.js` | カテゴリ関数削除、ツリー関数追加 |
| `frontend/scripts/modalHelper.js` | 親タスク選択UIに全面書き換え |
| `frontend/scripts/index.js` | カテゴリ処理削除、親ラベル表示 |
| `frontend/scripts/list.js` | グループ表示→ツリー表示 |
| `frontend/scripts/timeline.js` | カテゴリ表示→親タスク表示 |
| `frontend/scripts/calendar.js` | カテゴリ表示→親タスク表示 |
| `frontend/scripts/filter-ui.js` | カテゴリフィルター削除 |
| `frontend/pages/index.html` | 親タスク入力欄に変更 |
| `frontend/pages/list.html` | 親タスク入力欄に変更 |
| `frontend/pages/timeline.html` | 親タスク入力欄に変更 |
| `frontend/pages/calendar.html` | 親タスク入力欄に変更 |
| `frontend/styles/kanban.css` | 親ラベルスタイル追加 |
| `frontend/styles/list.css` | ツリー・親ピルスタイル追加 |
| `tests/test_task_store_bootstrap.py` | テスト更新・追加 |
