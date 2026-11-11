// Injected only into isolated native diagnostics, never ordinary application launches.
(async () => {
  const invoke = window.__TAURI__.core.invoke, checks = [];
  const { from, to } = window.scriptForgeUpdateProofVersions;
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const wait = async test => { const end = Date.now() + 120000; let lastError; while (true) { try { if (await test()) return; } catch (error) { lastError = error; } const updateError = document.querySelector('#scriptforge-update [data-error]')?.textContent; if (updateError) throw new Error(updateError); if (Date.now() > end) throw new Error(`Installed update UI timed out${lastError ? `: ${lastError}` : ''}`); await new Promise(resolve => setTimeout(resolve, 50)); } };
  try {
    const info = await invoke('desktop_diagnostics'), app = await invoke('desktop_app_info');
    const { fileService: files } = await import('/js/files.js');
    const directory = files.restoreHandle(info.directory);
    if (app.version === from && !location.pathname.endsWith('editor.html')) {
      const { parseFountain } = await import('/js/fountain.js');
      const { repository } = await import('/js/storage.js');
      const { DocumentSession, draftRecord } = await import('/js/session.js');
      const doc = parseFountain('Title: Installed update proof\n\nFADE IN:\n\nINT. TEST ROOM - DAY\n\nA synthetic screenplay survives an update.');
      let record = await repository.put(draftRecord(doc));
      await repository.setPreference('screenplayFolder', directory);
      await repository.setPreference('installedUpdateProof', { profile: 'Synthetic writer', theme: 'dark' });
      const session = new DocumentSession(repository, files, record, doc, { automatic: true });
      await session.saveToFolder(directory); record = session.record; session.dispose();
      const { BackupService } = await import('/js/backups.js');
      await new BackupService().capture(doc, 'Before Update');
      await files.createInFolder(directory, JSON.stringify({ id: doc.id, prefix: window.scriptForgeDiagnosticDatabasePrefix, handle: record.handle, expected: doc }), 'Update checkpoint');
      location.href = `editor.html?id=${doc.id}`; return;
    }
    const checkpointHandle = await directory.getFileHandle('Update checkpoint.fountain');
    const checkpointFile = await files.read(checkpointHandle);
    let checkpoint = JSON.parse(checkpointFile.source);
    if (app.version === from) {
      await wait(() => window.scriptForge?.getDocument() && document.getElementById('pages').contentEditable === 'true');
      await (await import('/js/updates.js')).setupUpdates(window);
      const root = document.getElementById('pages');
      const { restoreSelection } = await import('/js/selection.js');
      const type = text => {
        const element = window.scriptForge.getDocument().elements.find(element => element.type === 'action');
        assert(element, 'an editable screenplay element is rendered');
        restoreSelection(root, { anchor: { id: element.id, offset: element.text.length }, focus: { id: element.id, offset: element.text.length } });
        root.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
        assert(JSON.stringify(window.scriptForge.getDocument()).includes(text.trim()), 'pending edit enters the structured document');
      };
      await window.__TAURI__.event.emit('scriptforge-help', 'check');
      await wait(() => document.querySelector('#scriptforge-update [data-primary]')?.textContent === 'Update Now');
      document.querySelector('#scriptforge-update [data-later]').click();
      type(' Pending edit before installation.');
      await window.__TAURI__.event.emit('scriptforge-help', 'about');
      await wait(() => document.getElementById('about-scriptforge').open);
      document.querySelector('[data-about-check]').click();
      await wait(() => document.querySelector('#scriptforge-update [data-primary]')?.textContent === 'Update Now');
      assert(document.querySelector('#scriptforge-update [data-summary]').textContent.includes(to), 'About manual checking detects the signed newer version');
      document.querySelector('#scriptforge-update [data-primary]').click();
      await wait(() => document.querySelector('#scriptforge-update h1')?.textContent === (app.platform === 'windows' ? 'Update Ready to Install' : 'Update Ready'));
      if (app.platform === 'windows') assert(document.querySelector('#scriptforge-update [data-primary]').textContent === 'Install and Restart', 'Windows verifies the download and waits for explicit installation');
      else assert((await files.read(checkpoint.handle)).source.includes('Pending edit before installation.'), 'real installation saves pending edits to the linked file');
      document.querySelector('#scriptforge-update [data-later]').click();
      type(' Another edit before restart.');
      checkpoint.expected = window.scriptForge.getDocument(); checkpoint.checks = checks;
      await files.write(checkpointHandle, JSON.stringify(checkpoint), { expectedHash: checkpointFile.hash });
      await window.__TAURI__.event.emit('scriptforge-help', 'check');
      await wait(() => document.querySelector('#scriptforge-update [data-primary]')?.textContent === (app.platform === 'windows' ? 'Install and Restart' : 'Restart Now'));
      document.querySelector('#scriptforge-update [data-primary]').click(); return;
    }
    assert(app.version === to, `the replaced installed application relaunches as version ${to}`);
    checks.unshift(...checkpoint.checks);
    // Each diagnostic process has its own default database prefix. Inspect the old
    // process's explicitly recorded test database, never a real user database.
    const ownPrefix = window.scriptForgeDiagnosticDatabasePrefix;
    assert(/^scriptforge-stress-\d+-$/.test(checkpoint.prefix), 'checkpoint names only an isolated diagnostic database');
    window.scriptForgeDiagnosticDatabasePrefix = checkpoint.prefix;
    const { createRepository } = await import('/js/storage.js');
    const repository = createRepository(indexedDB);
    window.scriptForgeDiagnosticDatabasePrefix = ownPrefix;
    const record = await repository.get(checkpoint.id);
    assert(JSON.stringify(record.recovery.document) === JSON.stringify(checkpoint.expected), 'exact structured recovery survives replacement and restart');
    assert((await files.read(record.handle)).source.includes('Another edit before restart.'), 'restart flushes the post-install edit to the same Fountain file');
    assert((await repository.getPreference('installedUpdateProof')).profile === 'Synthetic writer', 'saved preferences survive the installed update');
    const folder = files.restoreHandle(await repository.getPreference('screenplayFolder'));
    assert(await folder.queryPermission({ mode: 'readwrite' }) === 'granted', 'native folder grants survive the update');
    const { BackupService } = await import('/js/backups.js');
    assert((await new BackupService().list(checkpoint.id)).length > 0, 'native backup history survives the update');
    await invoke('desktop_diagnostics_report', { report: { success: true, installedAndRestarted: true, from, to: app.version, checks } });
  } catch (error) {
    await invoke('desktop_diagnostics_report', { report: { success: false, error: String(error), stack: error.stack, checks } });
  }
})();
