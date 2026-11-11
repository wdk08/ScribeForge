import { automaticContinuations, continuedCue } from './continuations.js';
import { createDocument, createElement, meaningfulContent, newId, validateDocument } from './document.js';
import { parseFountain, serializeFountain } from './fountain.js';
import { fountainFilename } from './files.js';
import { parseInline } from './inline.js';

export function documentFingerprint(doc) {
  const overrides = doc.elements.filter(el => el.type === 'character').flatMap((el, index) => el.continuation ? [[index, el.continuation]] : []);
  const margins = doc.elements.flatMap((el,index) => el.rightMarginOffsetPt ? [[index,el.rightMarginOffsetPt]] : []);
  // Keep the legacy fingerprint byte-for-byte when no override exists.
  return JSON.stringify({ title: doc.title, elements: meaningfulContent(doc), whitespace: doc.elements.filter(el => el.type === 'whitespace').map(el => el.text), ...(overrides.length ? { continuations: overrides } : {}), ...(margins.length ? { margins } : {}) });
}
export const FOUNTAIN_LAYOUT_WARNING = 'Fountain saved literal text for temporary formatting that Fountain cannot represent. A Fountain-only round trip may change element types. Exact text and types remain in editor recovery.';

export function fountainForSaving(document, { onWarning = () => {} } = {}) {
  const doc = structuredClone(document);
  // Fountain is a portable presentation, not ScriptForge's internal JSON format.
  const continuations = automaticContinuations(document);
  // Canonical blocks give other importers blank separators and explicit cue/
  // transition markers (notably FADE IN and cues with lowercase extensions).
  const explicitStructure = doc.elements.some(el => ['character', 'transition'].includes(el.type));
  for (const el of doc.elements) if (el.type === 'character') {
    if (el.continuation === 'off') el.text = continuedCue(el.text, 'off');
    else if (continuations.has(el.id)) el.text = continuedCue(el.text);
    delete el.continuation;
  }
  const draftingTypes = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'centered', 'lyric'];
  // A heading being drafted may be blank (even after automatic numbering), or
  // end in the space just typed after INT./EXT. Fountain trims scene headings;
  // normalize only this export copy, leaving editor text and caret untouched.
  for (const el of doc.elements) if (el.type === 'scene') el.text = el.text.trim().toUpperCase();
  doc.elements = doc.elements.filter(el => el.type === 'scene' ? Boolean(el.text) : el.text || !draftingTypes.includes(el.type) || el.sceneNumber);
  let speech = false, projected = false;
  for (const el of doc.elements) {
    if (el.type === 'whitespace') continue;
    const orphan = ['dialogue','parenthetical'].includes(el.type) && !speech;
    const incomplete = el.type === 'parenthetical' && !/^\([^\n]*\)$/.test(el.text);
    const trimmed = ['character','transition','parenthetical','centered','section','synopsis'].includes(el.type)
      && el.text.trim() !== el.text;
    const invalidScene = el.type === 'scene' && !/^[\p{L}\p{N}]/u.test(el.text);
    const singleLine = ['scene','character','transition','centered','lyric','section','synopsis'].includes(el.type) && el.text.includes('\n');
    const hiddenDelimiter = (el.type === 'note' && (el.text.includes(']]') || el.text.endsWith(']')))
      || (el.type === 'boneyard' && el.text.includes('*/'));
    const speechSyntax = el.type === 'dialogue' && el.text.split('\n').some(line =>
      /^(?:[!@>~=]|\.[\p{L}\p{N}]|#+(?:\s|$)|\(.*\)$|\[\[.*\]\]$|\/\*.*\*\/$)/u.test(line.trim()));
    if (orphan || incomplete || trimmed || invalidScene || singleLine || hiddenDelimiter || speechSyntax) {
      el.type = 'action'; delete el.dual; delete el.continuation; delete el.sceneNumber; delete el.depth; delete el.rightMarginOffsetPt;
      projected = true;
    }
    if (el.type === 'character') speech = true;
    else if (!['dialogue','parenthetical','lyric','note','boneyard'].includes(el.type)) speech = false;
  }
  // A manual Action line can start with Fountain's forced-element syntax.
  // Keep its literal text, using separate explicit Action blocks only in the
  // export copy when one multiline block cannot express those boundaries.
  doc.elements = doc.elements.flatMap(el => {
    if (el.type !== 'action' || !el.text.split('\n').slice(1).some(line => /^[.!@>~#=]/.test(line.trimStart()))) return [el];
    projected = true;
    return el.text.split('\n').map(text => createElement('action', text));
  });
  if (projected) onWarning(FOUNTAIN_LAYOUT_WARNING);
  if (!doc.source || explicitStructure) return serializeFountain(doc, { canonical: true });
  // Preserve exact imported spelling whenever the arrangement still permits it.
  try { return serializeFountain(doc); } catch { return serializeFountain(doc, { canonical: true }); }
}
export function draftRecord(document = createDocument({ elements: [createElement('transition', 'FADE IN:'), createElement('action', '')] }), now = Date.now()) {
  const templateOnly = document.elements.length === 2 && document.elements[0].type === 'transition' && document.elements[0].text === 'FADE IN:' && document.elements[1].type === 'action' && !document.elements[1].text;
  return { id: document.id, title: document.title, createdAt: now, modifiedAt: now, revision: null,
    fileName: null, handle: null, fileHash: null, cachedSource: null, savedFingerprint: null,
    recovery: { document: structuredClone(document), selection: null,
      dirty: !templateOnly && document.elements.some(el => ['titleField', 'section', 'synopsis', 'note', 'boneyard', 'pageBreak'].includes(el.type) || el.text.trim()), at: now }, recoveryHistory: [] };
}
export async function recordForFile(opened, existing = null) {
  const title = opened.name.replace(/\.(?:fountain|txt)$/i, '');
  const doc = parseFountain(opened.source, { title, ...(existing ? { id: existing.id } : {}) });
  if (existing?.recovery?.document.settings) doc.settings = structuredClone(existing.recovery.document.settings);
  const plain = nodes => nodes.map(node => node.children ? plain(node.children) : ['note', 'boneyard'].includes(node.type) ? '' : node.text).join('');
  doc.title = plain(parseInline(doc.title)).replace(/\s+/g, ' ').trim() || title;
  const record = draftRecord(doc);
  return { ...record, ...(existing ? { createdAt: existing.createdAt, revision: existing.revision, fileDirectory: existing.fileDirectory, fileTitle: existing.fileTitle, pendingRenames: existing.pendingRenames } : {}),
    title: doc.title, fileName: opened.name, handle: opened.handle, fileHash: opened.hash,
    cachedSource: opened.source, savedFingerprint: documentFingerprint(doc),
    recovery: { document: doc, selection: null, dirty: false, at: Date.now() }, recoveryHistory: [] };
}

export const FILE_AUTOSAVE_DELAY = 600;

/** File writes and recovery commits are serialized; typing continues independently. */
export class DocumentSession {
  constructor(repository, files, record, document = record.recovery.document, { onState = () => {}, delay = 500, automatic = false, fileDelay = FILE_AUTOSAVE_DELAY } = {}) {
    validateDocument(document);
    this.repository = repository; this.files = files; this.record = record; this.document = document;
    this.selection = record.recovery.selection; this.onState = onState; this.delay = delay;
    this.generation = 0; this.persistedGeneration = -1; this.queue = Promise.resolve();
    this.storageError = null; this.fileError = null; this.missingFile = false; this.autoFile = false; this.busy = false;
    this.fountainWarnings = Array.isArray(record.fountainWarnings) ? record.fountainWarnings.filter(warning => typeof warning === 'string') : [];
    this.recovered = Boolean(record.recovery.dirty && record.savedFingerprint);
    this.automatic = automatic; this.fileDelay = fileDelay; this.autoPaused = false;
    this.autoFile = automatic && Boolean(record.handle || record.folderPending) && !this.recovered;
    if (record.folderSaveError) this.fileError = new Error(record.folderSaveError);
    if (record.revision != null && documentFingerprint(record.recovery.document) === documentFingerprint(document)) this.persistedGeneration = 0;
  }
  get dirty() { return documentFingerprint(this.document) !== this.record.savedFingerprint; }
  get recoveryCurrent() { return this.persistedGeneration === this.generation && !this.storageError; }
  emit() { this.onState(this); }
  enqueue(task) {
    const result = this.queue.then(task); this.queue = result.catch(() => {}); return result;
  }
  changed(document, selection) {
    if (document.id !== this.record.id) document = { ...document, id: this.record.id };
    if (this.automatic && this.recovered && documentFingerprint(document) !== documentFingerprint(this.document)) {
      // Continuing to edit a recovered document resumes its automatic saving;
      // simply opening recovery never writes the snapshot to the original file.
      this.recovered = false;
      this.autoFile = Boolean(this.record.handle || this.record.folderPending) && !this.autoPaused;
    }
    this.document = document; this.selection = structuredClone(selection); this.generation++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush({ disk: false }).catch(() => {}), this.delay);
    if (!this.maxTimer) this.maxTimer = setTimeout(() => this.flush({ disk: false }).catch(() => {}), 2000);
    clearTimeout(this.fileTimer);
    if (this.autoFile) this.fileTimer = setTimeout(() => this.flush().catch(() => {}), this.fileDelay);
    this.emit();
  }
  async persist(snapshot, generation, { force = false } = {}) {
    // Recovery timers often reach the queue after the same generation committed.
    // File-reference/hash changes still require a forced commit after disk I/O.
    if (generation < this.persistedGeneration || (!force && generation === this.persistedGeneration && !this.storageError)) return;
    if (snapshot.document.id !== this.record.id) snapshot = { ...snapshot, document: { ...snapshot.document, id: this.record.id } };
    const recovery = { ...snapshot, dirty: documentFingerprint(snapshot.document) !== this.record.savedFingerprint, at: Date.now() };
    const prior = this.record.recovery;
    const record = { ...this.record, title: snapshot.document.title, modifiedAt: recovery.at, recovery,
      recoveryHistory: prior && documentFingerprint(prior.document) !== documentFingerprint(snapshot.document)
        ? [prior, ...(this.record.recoveryHistory ?? [])].slice(0, 3) : this.record.recoveryHistory ?? [] };
    try {
      this.record = await this.repository.put(record, this.record.revision);
      this.persistedGeneration = generation; this.storageError = null;
    } catch (error) { this.storageError = error; this.autoFile = false; throw error; }
    finally { this.emit(); }
  }
  flush({ disk = true } = {}) {
    clearTimeout(this.timer); clearTimeout(this.maxTimer); this.maxTimer = null;
    return this.enqueue(async () => {
      // Queued timer requests share the latest state instead of cloning and
      // writing obsolete snapshots while a preceding save is still running.
      const generation = this.generation;
      const snapshot = { document: structuredClone(this.document), selection: structuredClone(this.selection) };
      try {
        await this.persist(snapshot, generation, { force: disk && this.autoFile && !this.record.handle });
        if (disk && this.record.pendingRenames?.length) {
          try { await this.performRenameCleanup(); }
          catch (error) { this.fileError = error; this.autoFile = false; this.emit(); return; }
        }
        if (disk && this.autoFile && generation === this.generation && this.dirty && !this.recovered) {
          clearTimeout(this.fileTimer);
          try {
            if (this.record.handle) await this.performWrite(snapshot.document, generation, this.record.handle, false, null, true);
            else await this.performFolderWrite(snapshot.document, generation, await this.repository.getPreference('screenplayFolder', null));
          }
          catch (error) { this.fileError = error; this.autoFile = false; this.emit(); }
        }
      } finally {
        // Home awaits flush before leaving. Catch up recovery if the user typed
        // during I/O, even when the older disk snapshot was deliberately skipped.
        if (generation < this.generation && this.persistedGeneration >= generation) {
          while (this.persistedGeneration < this.generation) {
            const latest = this.generation;
            await this.persist({ document: structuredClone(this.document), selection: structuredClone(this.selection) }, latest);
          }
        }
      }
    });
  }
  saveToFolder(directory) {
    const snapshot = structuredClone(this.document), generation = this.generation;
    return this.enqueue(() => this.record.handle
      ? this.performWrite(snapshot, generation, this.record.handle, false)
      : this.performFolderWrite(snapshot, generation, directory));
  }
  recreateMissingFile(directory) {
    return this.enqueue(async () => {
      try {
        if (!this.record.handle) throw new Error('There is no missing linked file to recreate.');
        this.missingFile = true;
        let current = null;
        try { current = await this.files.read(this.record.handle); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
        if (current && current.hash === this.record.fileHash) {
          throw new Error('The linked file is available again. Reconnect it instead of recreating it.');
        }
        // Some browser handles resolve by path: a newly created, different
        // file may now occupy it. Allocate another name without touching it.
        await this.persist({ document: structuredClone(this.document), selection: this.selection }, this.generation);
        // Allocate a safe filename, retaining the missing handle until the new
        // write succeeds. A file placed at the old name is never overwritten.
        const result = await this.performFolderWrite(structuredClone(this.document), this.generation, directory);
        this.recovered = false; this.missingFile = false;
        return result;
      } catch (error) { this.fileError = error; this.autoFile = false; throw error; }
      finally { this.emit(); }
    });
  }
  async performFolderWrite(snapshot, generation, directory) {
    this.busy = true; this.fileError = null; this.emit();
    try {
      if (!directory) throw new Error('Choose your Screenplay Folder to save this draft to disk.');
      this.fountainWarnings = [];
      const source = fountainForSaving(snapshot, { onWarning: warning => this.fountainWarnings.push(warning) });
      const result = await this.files.createInFolder(directory, source, snapshot.title, this.record.id);
      this.record = { ...this.record, handle: result.handle, fileName: result.name, cachedSource: source,
        fountainWarnings: [...this.fountainWarnings],
        fileHash: result.hash, savedFingerprint: documentFingerprint(snapshot), savedAt: Date.now(),
        folderPending: false, folderSaveError: null, downloadOnly: false, fileDirectory: directory, fileTitle: fountainFilename(snapshot.title) };
      this.recovered = false;
      await this.persist({ document: structuredClone(this.document), selection: this.selection }, this.generation, { force: true });
      this.autoFile = this.automatic;
      if (this.autoFile && this.dirty) {
        clearTimeout(this.fileTimer);
        this.fileTimer = setTimeout(() => this.flush().catch(() => {}), this.fileDelay);
      }
      return result;
    } catch (error) { this.fileError = error; this.autoFile = false; throw error; }
    finally { this.busy = false; this.emit(); }
  }
  save({ overrideHash = null } = {}) {
    if (!this.record.handle) return this.saveAs({ fork: false });
    clearTimeout(this.fileTimer);
    // Begin the permission request on the original user gesture, before queue work.
    const permission = this.files.ensurePermission(this.record.handle, 'readwrite', true).then(value => ({ value }), error => ({ error }));
    const snapshot = structuredClone(this.document), generation = this.generation, handle = this.record.handle;
    return this.enqueue(async () => {
      const grant = await permission; if (grant.error) throw grant.error;
      return this.performWrite(snapshot, generation, this.record.handle, false, overrideHash);
    });
  }
  saveAs({ fork = true } = {}) {
    const destination = this.files.pickSave(this.document.title).then(value => ({ value }), error => ({ error }));
    const snapshot = structuredClone(this.document), generation = this.generation;
    return this.enqueue(async () => {
      const picked = await destination; if (picked.error) throw picked.error;
      const handle = picked.value;
      let same = false;
      if (handle && this.record.handle) same = await handle.isSameEntry(this.record.handle);
      if (this.storageError?.name === 'StorageConflictError' && same) throw this.storageError;
      const before = { record: this.record, id: this.document.id, persistedGeneration: this.persistedGeneration, storageError: this.storageError };
      let forked = false;
      if (this.storageError?.name === 'StorageConflictError' || (fork && !same && this.record.fileName)) {
        forked = true;
        snapshot.id = newId(); this.document = { ...this.document, id: snapshot.id };
        this.record = draftRecord(this.document); this.persistedGeneration = -1; this.storageError = null;
      }
      try { return await this.performWrite(snapshot, generation, handle, !same); }
      catch (error) {
        if (forked) {
          this.record = before.record; this.document = { ...this.document, id: before.id };
          this.persistedGeneration = before.persistedGeneration; this.storageError = before.storageError;
          this.emit();
        }
        throw error;
      }
    });
  }
  async performWrite(snapshot, generation, handle, newDestination, overrideHash = null, background = false) {
    this.busy = true; this.fileError = null; this.emit();
    try {
      if (this.record.revision != null) {
        let latest;
        try { latest = await this.repository.get(this.record.id); }
        catch (error) { this.storageError = error; if (background) throw error; }
        if ((background && !latest) || (latest && latest.revision !== this.record.revision)) {
          const { StorageConflictError } = await import('./storage.js'); throw new StorageConflictError();
        }
      }
      if (this.record.pendingRenames?.length) await this.performRenameCleanup();
      this.fountainWarnings = [];
      const source = fountainForSaving(snapshot, { onWarning: warning => this.fountainWarnings.push(warning) });
      let directory = this.record.fileDirectory;
      // Recover ownership metadata for folder files created by earlier versions.
      const suffix = ` - ${this.record.id}`;
      const managedName = Boolean(directory) || (this.record.fileName?.includes(suffix) && this.record.fileName.endsWith('.fountain'));
      if (!directory && handle && managedName && this.repository.getPreference) {
        const candidate = await this.repository.getPreference('screenplayFolder', null);
        if (candidate) {
          try {
            const entry = await candidate.getFileHandle(this.record.fileName);
            if (await entry.isSameEntry(handle)) directory = candidate;
          } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        }
      }
      const base = fountainFilename(snapshot.title).replace(/\.fountain$/, '');
      const numbered = this.record.fileName?.slice(base.length);
      const matchingName = this.record.fileName === `${base}.fountain` || (/^ \(\d+\)\.fountain$/.test(numbered ?? '') && this.record.fileName.startsWith(base));
      const needsRename = directory && managedName && !matchingName;
      let oldFile = null;
      let result;
      if (needsRename) {
        // Verify the original before allocating a destination. Commit the new
        // reference before retiring the old name, so recovery always has a file.
        const current = await this.files.read(handle);
        if (current.hash !== (overrideHash ?? this.record.fileHash)) {
          const { FileConflictError } = await import('./files.js'); throw new FileConflictError(current);
        }
        result = await this.files.createInFolder(directory, source, snapshot.title, this.record.id);
        oldFile = { handle, name: this.record.fileName, hash: current.hash, directory };
        handle = result.handle;
      } else result = handle ? await this.files.write(handle, source, { expectedHash: overrideHash ?? this.record.fileHash, allowNewDestination: newDestination })
        : this.files.download(source, fountainFilename(snapshot.title));
      this.record = { ...this.record, handle: handle ?? null, fileName: result.name, cachedSource: source,
        fountainWarnings: [...this.fountainWarnings],
        fileHash: result.hash, savedFingerprint: documentFingerprint(snapshot), savedAt: Date.now(), downloadOnly: !handle,
        folderPending: false, folderSaveError: null, ...(directory ? { fileDirectory: directory, fileTitle: fountainFilename(snapshot.title) } : {}),
        pendingRenames: oldFile ? [...(this.record.pendingRenames ?? []), oldFile] : this.record.pendingRenames ?? [] };
      this.recovered = false;
      if (handle && this.automatic && !this.autoPaused) this.autoFile = true;
      // Save may finish after more typing; persist the latest text, keeping it dirty.
      try { await this.persist({ document: structuredClone(this.document), selection: this.selection }, this.generation, { force: true }); }
      catch (error) { if (error.name === 'StorageConflictError') this.autoFile = false; if (oldFile) throw error; }
      if (this.record.pendingRenames?.length) await this.performRenameCleanup();
      return result;
    } catch (error) {
      if (error.name === 'StorageConflictError') this.storageError = error;
      if (error.name === 'NotFoundError') this.missingFile = true;
      this.fileError = error; this.autoFile = false; throw error;
    } finally { this.busy = false; this.emit(); }
  }
  retryRenameCleanup() {
    return this.enqueue(async () => {
      try { await this.performRenameCleanup(); this.fileError = null; }
      catch (error) { this.fileError = error; this.autoFile = false; throw error; }
      finally { this.emit(); }
    });
  }
  async performRenameCleanup() {
    while (this.record.pendingRenames?.length) {
      const oldFile = this.record.pendingRenames[0];
      await this.files.retireRenamedFile(oldFile.directory ?? this.record.fileDirectory, oldFile);
      // Persist each completed cleanup. If persistence fails, repeating removal
      // is safe: a missing old entry counts as already retired.
      const next = { ...this.record, pendingRenames: this.record.pendingRenames.slice(1) };
      this.record = await this.repository.put(next, this.record.revision);
    }
  }
  async enableFileAutosave(enabled) {
    if (!enabled) { this.autoFile = false; this.autoPaused = true; clearTimeout(this.fileTimer); this.emit(); return; }
    if (!this.record.handle) throw new Error('Save to a linked local file before enabling file autosave.');
    if (this.recovered) throw new Error('Save your recovered changes explicitly before enabling file autosave.');
    await this.files.ensurePermission(this.record.handle, 'readwrite', true);
    this.autoFile = true; this.autoPaused = false; this.emit();
    if (this.dirty) await this.flush();
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.maxTimer); clearTimeout(this.fileTimer); }
}
