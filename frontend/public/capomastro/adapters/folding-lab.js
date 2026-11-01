/* Explicit functional derivative adapter. The sealed source is never rewritten. */
(() => {
  'use strict';
  const original = document.getElementById('dropZone');
  if (!original) return;
  const zone = original.cloneNode(false);
  original.replaceWith(zone); // Removes the original symbol-only drop listeners.
  zone.tabIndex = 0;
  zone.setAttribute('aria-label', 'Geometric Folding Lab document and text input');
  const label = document.createElement('label');
  label.htmlFor = 'foldingText';
  label.textContent = 'Drop documents here, paste text, or select framework symbols';
  const input = document.createElement('textarea');
  input.id = 'foldingText';
  input.rows = 5;
  input.placeholder = 'Drop symbols here to derive geometric folding & unity — or paste your text';
  input.maxLength = 100000;
  input.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin:12px 0;padding:12px;background:#181411;color:#eee;border:1px solid #4A9EF5;font:16px system-ui;resize:vertical';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = '.txt,.md,.csv,.json,.html,.htm,.pdf,.docx';
  picker.setAttribute('aria-label', 'Choose documents for the Folding Lab');
  const notice = document.createElement('p');
  notice.textContent = 'Functional integration view. Text and symbols calculate in this frame. Files are sent to the application server for transient text extraction, not saved or sent to AI. TXT, MD, CSV, JSON, HTML, text-bearing PDF and DOCX; 10 MiB/file, 5 files/drop, 100,000 characters and 5,000 tokens. Scanned PDFs require OCR elsewhere. Original download remains unchanged.';
  notice.style.cssText = 'font-size:13px;line-height:1.6;text-align:left;color:#c3cbd3';
  const message = document.createElement('p');
  message.id = 'foldingInputStatus';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  zone.append(label, input, picker, notice, message);
  const output = document.getElementById('foldingOutput');
  const resultBox = document.getElementById('foldingResults');
  let pending = null;
  let generation = 0;
  let busy = false;
  let serial = 0;
  const formats = new Set(['txt','md','csv','json','html','pdf','docx']);
  const primitives = {
    'δ':4, 'θ':9, 'ς':200, 'Λ':91, 'C':364, 'Fish':153,
    '777':777, 'custom':0, 'DenseONE':1, '74:47':121, '祧':0, 'Tiffany9':9,
  };
  function invalidate() { resultBox.style.display = 'none'; }
  function say(text, error = false) {
    message.textContent = text;
    message.style.color = error ? '#ff9c9c' : '#c3cbd3';
  }
  function add(text, replaceSelection = false) {
    const start = replaceSelection ? input.selectionStart : input.value.length;
    const end = replaceSelection ? input.selectionEnd : input.value.length;
    const separator = !replaceSelection && input.value ? '\n' : '';
    if (input.value.length - (end-start) + separator.length + text.length > 100000) {
      throw new Error('Input would exceed 100,000 characters. Nothing from this item was added.');
    }
    input.setRangeText(separator + text, start, end, 'end');
    invalidate();
  }
  input.addEventListener('input', () => { invalidate(); say('Input changed. Derive again to calculate the current text.'); });
  window.setupDragDrop = () => {}; // Prevents the original delayed setup from reattaching unsafe handlers.
  window.renderDropped = () => {};
  window.clearDropZone = () => {
    generation++;
    if (pending) {
      window.parent.postMessage({type:'folding:cancel',id:pending.id}, '*');
      pending.reject(new Error('Import cancelled'));
      pending = null;
    }
    busy = false;
    input.value = '';
    picker.value = '';
    invalidate();
    output.replaceChildren();
    say('Input and results cleared.');
  };
  document.querySelectorAll('.draggable').forEach(element => {
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `Add framework symbol ${element.dataset.symbol}`);
    element.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', element.dataset.symbol);
    });
    const insert = () => { try { add(element.dataset.symbol); say('Symbol added. Select Derive Folding & Unity to calculate.'); } catch (error) { say(error.message,true); } };
    element.addEventListener('click', insert);
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); insert(); }
    });
  });
  function extract(file, format, expectedGeneration) {
    return file.arrayBuffer().then(bytes => new Promise((resolve,reject) => {
      if (generation !== expectedGeneration) { reject(new Error('Import cancelled')); return; }
      const id = `folding-${Date.now()}-${++serial}`;
      const timer = setTimeout(() => {
        if (pending?.id === id) {
          window.parent.postMessage({type:'folding:cancel',id}, '*');
          pending = null;
          reject(new Error('Document extraction timed out; retry a smaller document.'));
        }
      }, 27000);
      pending = { id, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      window.parent.postMessage({type:'folding:extract',id,format,bytes}, '*', [bytes]);
    }));
  }
  window.addEventListener('message', event => {
    if (!pending || event.source !== window.parent || event.data?.type !== 'folding:extracted' || event.data.id !== pending.id) return;
    const request = pending;
    pending = null;
    if (typeof event.data.error === 'string') request.reject(new Error(event.data.error));
    else if (typeof event.data.text !== 'string' || event.data.text.length > 100000) request.reject(new Error('Invalid extraction response'));
    else request.resolve(event.data);
  });
  async function importFiles(files) {
    if (busy) { say('Wait for the current import, or Clear Zone to cancel it.',true); return; }
    if (files.length > 5) { say('Import at most five files at once. No files were imported.',true); return; }
    busy = true;
    const current = generation;
    const messages = [];
    try {
      for (const file of files) {
        if (current !== generation) break;
        let format = file.name.split('.').pop().toLowerCase();
        if (format === 'htm') format = 'html';
        if (!formats.has(format)) throw new Error(`Unsupported document: ${file.name}. Export as TXT, PDF or DOCX; legacy DOC and images are not supported.`);
        if (!file.size || file.size > 10*1024*1024) throw new Error(`${file.name}: file must be nonempty and at most 10 MiB.`);
        say(`Extracting ${file.name}…`);
        const result = await extract(file,format,current);
        if (current !== generation) break;
        add(result.text);
        messages.push(`${file.name}: ${result.text.length} characters imported. ${(result.limitations || []).join(' ')}`);
      }
      if (current === generation) say(messages.join(' ') + ' Select Derive Folding & Unity to calculate.');
    } catch (error) {
      if (current === generation) say(messages.join(' ') + ' ' + error.message + ' Existing input has been retained.',true);
    } finally { if (current === generation) busy = false; picker.value = ''; }
  }
  picker.addEventListener('change', () => void importFiles([...picker.files]));
  zone.addEventListener('dragover', event => { event.preventDefault(); zone.style.borderColor = '#FF9F1C'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = '#4A9EF5'; });
  zone.addEventListener('drop', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    zone.style.borderColor = '#4A9EF5';
    if (event.dataTransfer.files.length) void importFiles([...event.dataTransfer.files]);
    else try {
      add(event.dataTransfer.getData('text/plain'));
      say('Dropped text added. Select Derive Folding & Unity to calculate.');
    } catch (error) { say(error.message,true); }
  });
  zone.addEventListener('paste', event => {
    event.preventDefault();
    if (event.clipboardData.files.length) void importFiles([...event.clipboardData.files]);
    else try {
      add(event.clipboardData.getData('text/plain'), event.target === input);
      say('Pasted text added. Select Derive Folding & Unity to calculate.');
    } catch (error) { say(error.message,true); }
  });
  window.deriveUnity = () => {
    invalidate();
    if (busy) { say('Wait for document extraction before deriving.',true); return; }
    const tokens = input.value.match(/74:47|[\p{L}\p{M}\p{N}_]+/gu) || [];
    if (!tokens.length) { say('Enter or drop text or framework symbols first.',true); return; }
    if (tokens.length > 5000 || input.value.length > 100000) { say('Select a smaller excerpt: at most 5,000 tokens and 100,000 characters.',true); return; }
    const results = [], unsupported = [];
    for (const token of tokens) {
      if (Object.hasOwn(primitives,token)) {
        results.push({token, greek:'Declared framework primitive', value:primitives[token]});
      } else {
        const normalized = window.stripDiacritics(token.toLowerCase());
        if (!/^[a-zα-ωϛϝϙϡϲ]+$/u.test(normalized)) { unsupported.push(token); continue; }
        const greek = window.transliterate(token);
        if (!greek) { unsupported.push(token); continue; }
        results.push({token,greek,value:window.value(greek)});
      }
    }
    if (!results.length) { say('No supported Greek/Latin words or declared framework primitives were found. Unsupported input is not assigned a fabricated value.',true); return; }
    const total = results.reduce((sum,row) => sum + row.value,0);
    let root = 0;
    for (const row of results) root = window.gcd(root,row.value);
    output.replaceChildren();
    const summary = document.createElement('p');
    summary.id = 'foldingSummary';
    summary.textContent = `Parsed ${results.length} supported tokens; ${unsupported.length} unsupported. Sum = ${total}; sum modulo 364 = ${total % 364}; digital root = ${window.dr(total)}; common divisor = ${root}.`;
    const boundary = document.createElement('p');
    boundary.textContent = 'Finite symbolic arithmetic under the supplied mappings, not proof of physical folding, conservation or Unity. Framework Λ retains its declared 91; ordinary Greek λ has Milesian value 30. Repeated words are counted repeatedly. Unsupported tokens are excluded, not treated as zero.';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    ['Input','Mapping','Value','Value mod 364','Digital root'].forEach(text => { const cell=document.createElement('th'); cell.textContent=text; header.append(cell); });
    const body = table.createTBody();
    results.slice(0,100).forEach(row => {
      const tr=body.insertRow();
      [row.token,row.greek,row.value,row.value%364,window.dr(row.value)].forEach(text => { tr.insertCell().textContent=String(text); });
    });
    output.append(summary,boundary,table);
    if (results.length>100) { const info=document.createElement('p'); info.textContent='First 100 rows shown. Totals include every supported token.'; output.append(info); }
    if (unsupported.length) { const warning=document.createElement('p'); warning.textContent=`Partial calculation. Unmapped tokens (first 20): ${unsupported.slice(0,20).join(', ')}`; output.append(warning); }
    resultBox.style.display = 'block';
    say(unsupported.length ? 'Partial calculation; inspect excluded input below.' : 'Current input calculated. No proof or certification has been issued.');
  };
  say('Ready for text, document drops, keyboard selection or symbol dragging.');
})();
