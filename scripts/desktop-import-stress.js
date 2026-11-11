// Native diagnostics only. The initialization script isolates the working library.
(async () => {
  const invoke = window.__TAURI__.core.invoke;
  const state = JSON.parse(sessionStorage.getItem('import-stress') || '{"cycle":0,"ids":[],"samples":[],"errors":[]}');
  let manual = false;
  const save = () => sessionStorage.setItem('import-stress', JSON.stringify(state));
  const wait = async test => { const end = Date.now() + (manual ? 180000 : 45000); while (true) { try { if (test()) return; } catch {}  if (Date.now() > end) throw new Error(`Timed out at ${location.href}`); await new Promise(resolve => setTimeout(resolve, 50)); } };
  try {
    const { repository } = await import('/js/storage.js');
    const { fileService: files, readFountainFile } = await import('/js/files.js');
    const info = await invoke('desktop_diagnostics'); manual = info.manualKeyboard === true;
    if (location.pathname.endsWith('editor.html')) {
      state.stage = 'waiting for editor';
      await wait(() => window.scriptForge?.getDocument() && !document.body.classList.contains('loading-editor'));
      const doc = window.scriptForge.getDocument();
      if (!doc.elements.some(el => el.text.includes('Import stress proof'))) throw new Error('Imported content missing');
      if (!state.reopening) state.ids.push(doc.id);
      if (state.cycle === 1 && !state.shortcutProof) {
        const {restoreSelection} = await import('/js/selection.js');
        const {caret} = await import('/js/editing.js');
        const action = doc.elements.find(el => el.type === 'action'), root = document.getElementById('pages');
        restoreSelection(root,caret(action.id,3));
        const key = (key, options={}) => root.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
        const current = () => window.scriptForge.getDocument().elements.find(el=>el.id===action.id);
        const step = async (label, keyName, options, check) => {
          if (manual) {
            const notice=document.getElementById('notice');notice.hidden=false;notice.textContent=`Native keyboard test: ${label}`;
          } else key(keyName,options);
          await wait(check);
        };
        await step('Cmd + [','[',{metaKey:true},()=>current().rightMarginOffsetPt===5);
        await step('Cmd + ]',']',{metaKey:true},()=>current().rightMarginOffsetPt===undefined);
        if(manual){ await step('Cmd + [ again','[',{metaKey:true},()=>current().rightMarginOffsetPt===5); }
        else key('[',{metaKey:true});
        await step('Cmd + backslash','\\',{metaKey:true},()=>current().rightMarginOffsetPt===undefined);
        await step('Shift + Return','Enter',{shiftKey:true},()=>current().text===action.text.slice(0,3)+'\n'+action.text.slice(3));
        key('z',{metaKey:true});
        if(current().text!==action.text || current().rightMarginOffsetPt!==undefined)throw new Error('Native shortcut undo did not restore the element');
        const width = parseFloat(root.querySelector('.active-writing-area').style.width);
        for(let i=0;i<8;i++){
          key('[',{metaKey:true});
          const inset = root.querySelector('.active-writing-area');
          if(Math.abs(width-parseFloat(inset.style.width)-20/3)>.001)throw new Error('Native highlight does not match the five-point boundary change');
          root.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'x'}));
          key(']',{metaKey:true});
          root.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward'}));
        }
        if(current().text!==action.text || current().rightMarginOffsetPt!==undefined || window.scriptForge.getSelection().focus.offset!==3)throw new Error('Rapid native margin/typing sequence changed content or selection');
        state.shortcutProof={mode:manual?'physical macOS keys':'native DOM keyboard events',marginStepPt:5,reset:true,softBreak:true,undo:true,rapidTypingCycles:8,highlightTracksWidth:true};
        document.getElementById('notice').hidden=true;
      }

      // A real edit and recovery/disk save immediately precede Home navigation.
      const action = document.querySelector('[data-type=action]'), range = document.createRange();
      range.selectNodeContents(action); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.getElementById('pages').dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' Edited.' }));
      state.stage = 'waiting for autosave hookup';
      await wait(() => window.scriptForge.getFileState()?.autoFile);
      state.stage = 'waiting for save'; document.getElementById('save').click();
      await wait(() => window.scriptForge.getFileState()?.recoveryCurrent && !window.scriptForge.getFileState()?.dirty);
      state.samples.push({ cycle: state.cycle, phase: 'editor', elements: document.querySelectorAll('*').length, pages: document.querySelectorAll('.screenplay-page').length });
      save(); document.getElementById('home').click();
    } else {
      await import('/js/home.js');
      state.stage = 'home initialized';
      if (state.reopening) {
        const rows = await repository.list();
        if (state.ids.some(id => !rows.some(row => row.id === id))) throw new Error('An imported document disappeared');
        await invoke('desktop_diagnostics_report', { report: { success: true, imports: state.cycle, ids: state.ids, samples: state.samples, errors: state.errors, shortcutProof: state.shortcutProof } }); return;
      }
      if (state.cycle === 10) {
        state.reopening = true; save();
        location.href = `./editor.html?id=${encodeURIComponent(state.ids[0])}`; return;
      }
      if (!state.cycle) {
        try { await readFountainFile(new File(['bad\0binary'], 'invalid.fountain')); throw new Error('Binary accepted'); }
        catch (error) { if (!error.message.includes('binary')) throw error; }
      }
      const directory = files.restoreHandle(info.directory);
      await repository.setPreference('screenplayFolder', directory);
      if (!state.fixture) {
        const source = 'Title: Import stress proof\n\n' + Array.from({length:100}, (_, i) => `INT. ROOM ${i} - DAY\n\nImport stress proof. ${'An ordinary screenplay action. '.repeat(20)}\n\nANN\nThis is a test.\n`).join('\n');
        const file = await files.createInFolder(directory, source, 'Import stress proof');
        state.fixture = file.handle;
      }
      // Alternate original native file and distinct imported copies; repeat same handle.
      const opened = await files.read(files.restoreHandle(state.fixture));
      files.open = async () => state.cycle % 2 ? { ...opened, handle: null, name: `Copy ${state.cycle}.fountain` } : opened;
      const { openFileIntoLibrary } = await import('/js/library.js');
      const imported = await openFileIntoLibrary();
      state.stage = 'valid import'; state.cycle++; save(); location.href = `./editor.html?id=${encodeURIComponent(imported.id)}`;
    }
  } catch (error) { await invoke('desktop_diagnostics_report', { report: { success: false, ...state, error: `${error.message} ${error.stack ?? ''}`, fileState: window.scriptForge?.getFileState(), banner: document.getElementById('banner-message')?.textContent, notice: document.getElementById('notice')?.textContent } }); }
})();
