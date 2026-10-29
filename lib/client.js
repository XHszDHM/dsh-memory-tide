/**
 * client.js — 设置页里「潮汐记忆」那一栏。
 *
 * 手写的一份宿主浏览器端 bundle（没有构建步骤，也没有 esbuild）：
 * 按 `window.__ModuleLoader__` 的约定包一层 factory，里面是普通 CommonJS。
 * React 由宿主提供，`require('react')` 就能拿到。
 *
 * 它只做三件事：列出用过记忆的工作空间、读那一份 `.tide.json`、改完写回去。
 * 真正的读写都走宿主端点 `/api/dsh-memory-tide`（见 src/server.js）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-memory-tide',
  factory: function (require) {
    var React = require('react');
    if (React && React.default && !React.createElement) React = React.default;
    var h = React.createElement;

    var ENDPOINT = 'dsh-memory-tide';

    var FIELDS = [
      { key: 'hotKeepDays', label: '热档保留天数', hint: '近 N 天的记忆一定留在热档，不动。' },
      { key: 'promoteHits', label: '钉住门槛（被查次数）', hint: '过了保留期的记忆，被查过这么多次就钉在热档。' },
      { key: 'coldPromoteHits', label: '冷档升回门槛', hint: '冷档里的记忆被查过这么多次，升回热档并钉住。' },
      { key: 'pinMaxDays', label: '钉住有效期（天）', hint: '钉住的记忆连续这么多天没被查，就解钉。' },
      { key: 'coldMaxFiles', label: '冷档最多几个文件', hint: '超了按日期从早到晚删。' },
      { key: 'hotMaxFiles', label: '热档最多几个文件', hint: '0 = 不限。' },
      { key: 'sectionWarn', label: '日记小节告警线', hint: '一天的小节超过这个数，体检时提示该拆分。' },
      { key: 'searchLimit', label: '搜索默认返回条数', hint: '不传 limit 时用这个。' },
      { key: 'searchContext', label: '搜索上下文行数', hint: '命中一处，前后各带几行。' }
    ];

    /** 调宿主端点，顺手把 {ok,value} 这层信封拆掉。 */
    function call(connection, method, payload, signal) {
      if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') {
        return Promise.reject(new Error('还没连上宿主，稍等一下再试'));
      }
      return connection.rpc
        .call('/api', ENDPOINT, { method: method, payload: payload }, signal)
        .then(function (response) {
          if (response && typeof response === 'object' && response.ok === true) return response.value;
          if (response && typeof response === 'object' && response.ok === false) {
            var message = response.error && response.error.message ? response.error.message : '读取失败';
            throw new Error(message);
          }
          return response;
        });
    }

    var styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0', maxWidth: '640px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      label: { fontSize: '0.8125rem', opacity: 0.75, minWidth: '11em' },
      hint: { fontSize: '0.75rem', opacity: 0.55, lineHeight: 1.5 },
      select: { padding: '6px 8px', borderRadius: '6px', border: '1px solid currentColor',
        background: 'transparent', color: 'inherit', minWidth: '22em', maxWidth: '100%' },
      input: { padding: '6px 8px', borderRadius: '6px', border: '1px solid currentColor',
        background: 'transparent', color: 'inherit', width: '7em' },
      path: { fontSize: '0.75rem', opacity: 0.55, wordBreak: 'break-all' },
      button: { padding: '6px 14px', borderRadius: '6px', border: '1px solid currentColor',
        background: 'transparent', color: 'inherit', cursor: 'pointer' },
      note: { fontSize: '0.8125rem', lineHeight: 1.6 },
      group: { display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px',
        borderTop: '1px solid rgba(128,128,128,0.25)' }
    };

    function SettingsPanel(props) {
      var connection = props.connection;
      var abortRef = React.useRef(null);
      var state = React.useState({ loading: true, error: null, roots: [], root: '', config: null,
        defaults: null, configFile: '', exists: false, hasMemory: false });
      var view = state[0];
      var setView = state[1];
      var draftState = React.useState({});
      var draft = draftState[0];
      var setDraft = draftState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noteState = React.useState('');
      var note = noteState[0];
      var setNote = noteState[1];
      var manualState = React.useState('');
      var manual = manualState[0];
      var setManual = manualState[1];

      var patch = function (next) {
        setView(function (old) {
          var merged = {};
          for (var key in old) merged[key] = old[key];
          for (var key2 in next) merged[key2] = next[key2];
          return merged;
        });
      };

      var loadConfig = React.useCallback(function (root) {
        if (!root) return Promise.resolve();
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = controller;
        setBusy(true);
        setNote('');
        return call(connection, 'config.read', { root: root }, controller ? controller.signal : undefined)
          .then(function (result) {
            var nextDraft = {};
            for (var i = 0; i < FIELDS.length; i++) nextDraft[FIELDS[i].key] = String(result.config[FIELDS[i].key]);
            setDraft(nextDraft);
            patch({ root: result.root, config: result.config, defaults: result.defaults,
              configFile: result.configFile, exists: result.exists, hasMemory: result.hasMemory, error: null });
          })
          .catch(function (error) { patch({ error: error.message }); })
          .then(function () { setBusy(false); });
      }, [connection]);

      React.useEffect(function () {
        var alive = true;
        setBusy(true);
        call(connection, 'workspace.list', {})
          .then(function (result) {
            if (!alive) return;
            var roots = (result && result.roots) || [];
            patch({ roots: roots, loading: false });
            if (roots.length > 0) loadConfig(roots[0].root);
            else setBusy(false);
          })
          .catch(function (error) {
            if (alive) patch({ error: error.message, loading: false });
            setBusy(false);
          });
        return function () {
          alive = false;
          if (abortRef.current) abortRef.current.abort();
        };
      }, [connection, loadConfig]);

      var onPick = function (event) {
        var root = event.target.value;
        if (root) loadConfig(root);
      };

      var onManual = function () {
        var value = manual.trim();
        if (value) loadConfig(value);
      };

      var onField = function (key, value) {
        setDraft(function (old) {
          var next = {};
          for (var item in old) next[item] = old[item];
          next[key] = value;
          return next;
        });
      };

      var payloadFromDraft = function () {
        var out = {};
        for (var i = 0; i < FIELDS.length; i++) {
          var key = FIELDS[i].key;
          var number = Number(draft[key]);
          out[key] = Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
        }
        return out;
      };

      var onSave = function () {
        if (!view.root) return;
        setBusy(true);
        setNote('');
        call(connection, 'config.write', { root: view.root, config: payloadFromDraft() })
          .then(function (result) {
            setNote('已保存到 ' + result.configFile);
            setView(function (old) {
              var next = {};
              for (var key in old) next[key] = old[key];
              next.config = result.config;
              next.exists = true;
              return next;
            });
            setDraft(function (old) {
              var next = {};
              for (var key2 in old) next[key2] = old[key2];
              for (var i = 0; i < FIELDS.length; i++) next[FIELDS[i].key] = String(result.config[FIELDS[i].key]);
              return next;
            });
          })
          .catch(function (error) { setNote('保存失败：' + error.message); })
          .then(function () { setBusy(false); });
      };

      var onReset = function () {
        if (!view.root) return;
        setBusy(true);
        setNote('');
        call(connection, 'config.reset', { root: view.root })
          .then(function (result) {
            setNote('已恢复默认值');
            setView(function (old) {
              var next = {};
              for (var key in old) next[key] = old[key];
              next.config = result.config;
              next.exists = true;
              return next;
            });
            setDraft(function (old) {
              var next = {};
              for (var key2 in old) next[key2] = old[key2];
              for (var i = 0; i < FIELDS.length; i++) next[FIELDS[i].key] = String(result.config[FIELDS[i].key]);
              return next;
            });
          })
          .catch(function (error) { setNote('恢复失败：' + error.message); })
          .then(function () { setBusy(false); });
      };

      if (view.loading) return h('div', { style: styles.wrap }, h('div', { style: styles.hint }, '正在读取…'));

      var children = [];

      children.push(h('div', { key: 'intro', style: styles.hint },
        '记忆跟着工作空间走：每个工作空间有自己的 memory 目录和一份配置。这里选的参数只影响选中的那一个。'));

      if (view.error) {
        children.push(h('div', { key: 'err', style: { fontSize: '0.8125rem', color: '#d9534f' } }, view.error));
      }

      var options = view.roots.map(function (item) {
        var title = item.title && item.title !== item.root ? item.title + '　' : '';
        var tail = (item.isDefault ? '（当前）' : '') + (item.hasMemory ? '' : '（还没有记忆）');
        return h('option', { key: item.root, value: item.root }, title + item.root + tail);
      });
      if (view.root && !view.roots.some(function (item) { return item.root === view.root; })) {
        options.push(h('option', { key: view.root, value: view.root }, view.root));
      }

      children.push(h('div', { key: 'picker', style: styles.row },
        h('span', { style: styles.label }, '工作空间'),
        h('select', {
          style: styles.select,
          value: view.root || '',
          disabled: busy,
          onChange: onPick
        }, options.length > 0 ? options : h('option', { value: '' }, '（还没有记录，先手输一个）'))
      ));

      children.push(h('div', { key: 'manual', style: styles.row },
        h('span', { style: styles.label }, '其它路径'),
        h('input', {
          style: Object.assign({}, styles.select, { minWidth: '22em' }),
          type: 'text',
          placeholder: '粘贴一个工作空间的绝对路径',
          value: manual,
          disabled: busy,
          onChange: function (event) { setManual(event.target.value); },
          onKeyDown: function (event) { if (event.key === 'Enter') onManual(); }
        }),
        h('button', { style: styles.button, type: 'button', disabled: busy, onClick: onManual }, '读取')
      ));

      if (view.root) {
        children.push(h('div', { key: 'meta', style: styles.path },
          view.root + (view.exists ? '' : '　·　这个工作空间还没有配置文件，保存时会新建')));
      }

      if (view.root) {
        var rows = FIELDS.map(function (field) {
          return h('div', { key: field.key, style: styles.row },
            h('span', { style: styles.label }, field.label),
            h('input', {
              style: styles.input,
              type: 'number',
              min: '0',
              step: '1',
              value: draft[field.key] === undefined ? '' : draft[field.key],
              disabled: busy,
              onChange: function (event) { onField(field.key, event.target.value); }
            }),
            h('span', { style: styles.hint }, field.hint)
          );
        });
        children.push(h('div', { key: 'fields', style: styles.group }, rows));
        children.push(h('div', { key: 'actions', style: styles.row },
          h('button', { style: styles.button, type: 'button', disabled: busy, onClick: onSave }, busy ? '处理中…' : '保存'),
          h('button', { style: styles.button, type: 'button', disabled: busy, onClick: onReset }, '恢复默认'),
          h('span', { style: styles.hint }, note)
        ));
      }

      return h('div', { style: styles.wrap }, children);
    }

    function apply(ctx) {
      var stop = ctx.slots.inject('settings.section', function () {
        var unregister = ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-memory-tide',
          order: 55,
          label: function () { return '潮汐记忆'; },
          inject: function () { return {}; }
        }, function buildPanelElement() {
          return h(SettingsPanel, { connection: ctx.connection });
        });
        return function () { unregister(); };
      });
      return function () {
        try {
          if (typeof stop === 'function') stop();
        } catch (error) {
          /* 卸载时安静一点 */
        }
      };
    }

    return { name: 'dsh-memory-tide-settings', inject: ['slots', 'connection'], apply: apply };
  }
});
