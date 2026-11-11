// Executed only by an explicitly requested, isolated native smoke-test launch.
(async () => {
  const invoke = window.__TAURI__.core.invoke;
  const report = { success: false, checks: [] };
  const assert = (value, message) => { if (!value) throw new Error(message); report.checks.push(message); };
  let session, runtime;
  try {
    const info = await invoke('desktop_diagnostics');
    const { fileService: files } = await import('/js/files.js');
    const { BackupService } = await import('/js/backups.js');
    await import('/js/home.js');
    assert(!document.querySelector('.startup-error') && document.getElementById('library-error').hidden, 'native homepage initializes without JavaScript or storage errors');
    assert(files.usesDesktop && files.supportsDirectories, 'folder saving uses the native bridge');
    assert(location.protocol === 'tauri:' || location.hostname === 'tauri.localhost', 'frontend runs from embedded desktop assets');
    if (info.restart) {
      const previous = info.previous;
      const { createRepository } = await import('/js/storage.js');
      const working = createRepository(indexedDB, previous.workingDatabase);
      const recovered = await working.get(previous.documentId);
      assert(recovered.recovery.document.elements.some(el => el.rightMarginOffsetPt === 3 && el.text.includes('\nManual break proof.')), 'native recovery retains per-element margin and explicit break after restart');
      assert(recovered.recovery.document.title === 'Desktop renamed proof', 'WebKit working recovery survives a process restart');
      const folder = files.restoreHandle(await working.getPreference('screenplayFolder', null));
      assert(await folder.queryPermission({ mode: 'readwrite' }) === 'granted', 'selected folder remains available after restarting');
      const reopened = await files.read(previous.handle);
      assert(reopened.source.includes('Desktop renamed proof'), 'native file grant and screenplay survive a process restart');
      const versions = await new BackupService().list(previous.documentId);
      assert(versions.length >= 2, 'independent native version history survives a process restart');
    } else {
      const realFetch = window.fetch.bind(window);
      window.fetch = (resource, ...args) => {
        const url = typeof resource === 'string' ? resource : resource.url ?? String(resource);
        if (/localhost:4173|127\.0\.0\.1:4173|\/api\/local-files\//.test(url)) throw new Error('Desktop unexpectedly required the localhost server.');
        return realFetch(resource, ...args);
      };
      const { parseFountain } = await import('/js/fountain.js');
      const { EditorHistory, caret } = await import('/js/editing.js');
      const { DocumentSession, draftRecord } = await import('/js/session.js');
      const { createMeasurer, layoutUnits, paginate } = await import('/js/pagination.js');
      const { renderPages } = await import('/js/renderer.js');
      await (await import('/js/screenplay-format.js')).ensureScreenplayFonts();
      const proofHost = document.createElement('div'); proofHost.className = 'measurement pdf-measure'; document.body.append(proofHost);
      const proofMeasure = createMeasurer(proofHost);
      report.wrappingProof = ['Or... You be a dinosaur and I be a princess', 'She finally gets to the top of the playground and looks down at Luke'].map((text, index) => {
        const type = index ? 'action' : 'dialogue', lines = proofMeasure({ type, text });
        return { type, lines: lines.map(line => text.slice(line.start, line.end)), font: getComputedStyle(proofHost.firstChild).font, width: proofHost.firstChild.getBoundingClientRect().width };
      }); proofHost.remove();
      assert(report.wrappingProof[0].lines[1] === 'princess' && report.wrappingProof[1].lines[1] === 'at Luke', 'native WebKit wraps whole words with the bundled Courier Prime');
      const directory = files.restoreHandle(info.directory);
      const doc = parseFountain('Title: Desktop proof\n\nFADE IN:\n\nINT. ROOM - DAY\n\nA light turns on.\n\nANN\nThe desktop editor works.');
      const action = doc.elements.find(el => el.type === 'action');
      action.rightMarginOffsetPt = 3; action.text += '\nManual break proof.';
      const history = new EditorHistory(doc, caret(action.id, action.text.length));
      let record = { ...draftRecord(doc), revision: 1 };
      const repository = { get: async () => structuredClone(record), getPreference: async () => null, put: async (next, revision) => { if (record.revision !== revision) throw new Error('Revision conflict'); record = { ...next, revision: revision + 1 }; return record; } };
      session = new DocumentSession(repository, files, record, doc, { automatic: true });
      await session.saveToFolder(directory);
      const originalHandle = session.record.handle;
      const edited = history.apply(history.current.selection, { type: 'insert', text: ' The scene continues.' });
      session.changed(edited.document, edited.selection); await session.save();
      assert((await files.read(originalHandle)).source.includes('The scene continues.'), 'editing saves to the same native Fountain file');
      try { await files.write(originalHandle, 'Incorrect overwrite', { expectedHash: 'stale' }); throw new Error('Conflict was ignored'); }
      catch (error) { assert(error.name === 'FileConflictError', 'outside file changes cannot be silently overwritten'); }
      const duplicate = await files.createInFolder(directory, 'INT. ROOM - DAY\n\nAnother script.', 'Desktop proof');
      assert(duplicate.name === 'Desktop proof (2).fountain', 'duplicate titles use a numbered filename');
      const renamed = history.apply(history.current.selection, { type: 'titlePage', field: 'title', value: 'Desktop renamed proof' });
      session.changed(renamed.document, renamed.selection); await session.save();
      assert(session.record.fileName === 'Desktop renamed proof.fountain', 'managed file names follow title changes');
      try { await files.read(originalHandle); throw new Error('Old file remains'); }
      catch (error) { assert(error.name === 'NotFoundError', 'successful rename retires the previous file'); }
      const backups = new BackupService();
      await backups.capture(doc, 'Manual Backup');
      await backups.capture(renamed.document, 'Before Restore');
      const versions = await backups.list(doc.id);
      assert(versions.length === 2, 'structured backups use native app-data storage');
      const restored = history.apply(history.current.selection, { type: 'restoreVersion', document: versions.find(item => item.reason === 'Manual Backup').document });
      assert(restored.document.title === 'Desktop proof', 'a native backup restores through the normal document model');
      const measurement = document.createElement('div'); measurement.className = 'measurement'; document.body.append(measurement);
      const pages = paginate(layoutUnits(renamed.document, createMeasurer(measurement))); measurement.remove();
      const preview = document.createElement('div'); renderPages(preview, pages, renamed.document);
      assert(preview.querySelectorAll('.screenplay-page').length > 0 && pages.every(page => page.used <= 864), 'embedded editor renders measured screenplay pages');
      const { createScreenplayPDF } = await import('/js/pdf-export.js');
      const pdf = await createScreenplayPDF(renamed.document);
      assert(new TextDecoder().decode((await pdf.blob.arrayBuffer()).slice(0, 5)) === '%PDF-', 'embedded fonts and PDF export produce a real PDF');
      if (info.layoutSource) {
        const proof = parseFountain(info.layoutSource); proof.settings = { ...proof.settings, sceneNumbers: true };
        proof.elements.find(el => el.type === 'dialogue').rightMarginOffsetPt = 4;
        const snapshot = JSON.stringify(proof), host = document.createElement('div'); host.className = 'measurement'; document.body.append(host);
        const editorPages = paginate(layoutUnits(proof, createMeasurer(host))); host.remove();
        const result = await createScreenplayPDF(proof);
        assert(result.pages === editorPages.length + 1 && editorPages.every(page => page.used <= 864), 'feature-length desktop editor and PDF agree on screenplay page count without overflow');
        assert(JSON.stringify(proof) === snapshot, 'desktop reference export preserves every structured screenplay element');
        report.layoutProof = { screenplayPages: editorPages.length, pdfPages: result.pages, scenes: proof.elements.filter(el => el.type === 'scene').length,
          fonts: [...document.fonts].map(f => ({ family: f.family, style: f.style, weight: f.weight, status: f.status })) };
        await invoke('desktop_diagnostics_pdf', { bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())) });
      }
      if (info.config) {
        const { PiperRuntime } = await import('/js/piper-runtime.js');
        const model = new Blob([await invoke('desktop_diagnostics_model')]);
        runtime = new PiperRuntime();
        const audio = await runtime.synthesize({ modelId: 'desktop-smoke', model, config: info.config, text: 'ScriptForge is ready for your next scene.' });
        const context = new OfflineAudioContext(1, audio.samples.length, audio.sampleRate);
        const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate); buffer.copyToChannel(audio.samples, 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
        const rendered = await context.startRendering();
        assert(rendered.duration > .1 && rendered.getChannelData(0).some(value => Math.abs(value) > .001), 'Piper ONNX generates playable local audio under the packaged CSP');
        report.audioSeconds = rendered.duration;
      }
      const { createRepository } = await import('/js/storage.js');
      const workingDatabase = `scriptforge-desktop-smoke-${doc.id}`;
      const working = createRepository(indexedDB, workingDatabase);
      await working.put(session.record); await working.setPreference('screenplayFolder', directory);
      assert((await working.get(doc.id)).recovery.document.title === 'Desktop renamed proof', 'native handles and recovery persist in WebKit IndexedDB');
      report.handle = session.record.handle; report.documentId = doc.id; report.workingDatabase = workingDatabase;
    }
    report.success = true;
  } catch (error) { report.error = error?.stack ?? error?.message ?? String(error); }
  finally {
    runtime?.dispose(); session?.dispose();
    await invoke('desktop_diagnostics_report', { report });
  }
})();
