// The page served to the phone's browser. Self-contained (inline CSS/JS, no external
// refs) and served outside the Electron renderer's CSP, so it's unconstrained. The
// session token is baked into the POST URL.

export function renderUploadPage(token: string): string {
  // token is a hex string from crypto.randomBytes, so it needs no escaping.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Send to Timeline</title>
<style>
  :root { --accent: #4f46e5; --ok: #16a34a; --err: #dc2626; --bg: #f4f4f6; --card: #fff; --text: #18181b; --sub: #71717a; --line: #e4e4e7; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0c0c0f; --card: #17171b; --text: #f4f4f5; --sub: #a1a1aa; --line: #2a2a30; } }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font: 16px/1.4 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text);
         padding: max(20px, env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom)); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--sub); font-size: 14px; margin: 0 0 24px; }
  label.pick { display: block; text-align: center; background: var(--accent); color: #fff; font-weight: 600;
               padding: 18px; border-radius: 14px; cursor: pointer; font-size: 17px; }
  label.pick:active { opacity: .85; }
  input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  ul { list-style: none; padding: 0; margin: 20px 0 0; display: flex; flex-direction: column; gap: 10px; }
  li { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .status { font-size: 13px; font-weight: 600; flex-shrink: 0; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin-top: 8px; }
  .bar > div { height: 100%; width: 0; background: var(--accent); transition: width .15s; }
  .retry { border: 1px solid var(--line); background: transparent; color: var(--accent); font-weight: 600;
           border-radius: 8px; padding: 6px 12px; font-size: 13px; }
  .done-msg { margin-top: 20px; text-align: center; color: var(--ok); font-weight: 600; }
</style>
</head>
<body>
<h1>Send to Timeline</h1>
<p class="sub">Pick photos and videos to add to your library on this Wi-Fi.</p>
<label class="pick" for="picker">Choose photos &amp; videos</label>
<input id="picker" type="file" multiple accept="image/*,video/*">
<ul id="list"></ul>
<div id="doneMsg" class="done-msg" hidden>All uploaded — pick more or close this tab.</div>
<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var CONCURRENCY = 2;
  var list = document.getElementById('list');
  var doneMsg = document.getElementById('doneMsg');
  var picker = document.getElementById('picker');
  var queue = [];
  var active = 0;

  picker.addEventListener('change', function () {
    doneMsg.hidden = true;
    var files = Array.prototype.slice.call(picker.files || []);
    files.forEach(add);
    picker.value = '';
    pump();
  });

  function add(file) {
    var li = document.createElement('li');
    var row = document.createElement('div'); row.className = 'row';
    var name = document.createElement('span'); name.className = 'name'; name.textContent = file.name;
    var status = document.createElement('span'); status.className = 'status'; status.textContent = 'Waiting';
    row.appendChild(name); row.appendChild(status);
    var bar = document.createElement('div'); bar.className = 'bar';
    var fill = document.createElement('div'); bar.appendChild(fill);
    li.appendChild(row); li.appendChild(bar);
    list.appendChild(li);
    queue.push({ file: file, status: status, fill: fill, li: li, row: row });
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      active++;
      upload(queue.shift());
    }
    if (active === 0 && queue.length === 0 && list.children.length && !hasError()) {
      doneMsg.hidden = false;
    }
  }

  function hasError() {
    return !!list.querySelector('.status.err');
  }

  function upload(item) {
    item.status.className = 'status';
    item.status.textContent = 'Uploading';
    var fd = new FormData();
    fd.append('file', item.file, item.file.name);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?token=' + encodeURIComponent(TOKEN));
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) item.fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = function () {
      active--;
      if (xhr.status === 200) {
        item.fill.style.width = '100%';
        item.status.className = 'status ok';
        item.status.textContent = 'Sent';
      } else {
        fail(item);
      }
      pump();
    };
    xhr.onerror = function () { active--; fail(item); pump(); };
    xhr.send(fd);
  }

  function fail(item) {
    item.status.className = 'status err';
    item.status.textContent = 'Failed';
    if (!item.row.querySelector('.retry')) {
      var btn = document.createElement('button');
      btn.className = 'retry'; btn.textContent = 'Retry';
      btn.onclick = function () {
        item.row.removeChild(btn);
        item.fill.style.width = '0';
        queue.push(item);
        pump();
      };
      item.row.appendChild(btn);
    }
  }
})();
</script>
</body>
</html>`
}
