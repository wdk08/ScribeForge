import { setupLibraryStatistics } from './library-statistics.js';
import { encodeManuscript } from './model.js';
import { libraryStore } from './storage.js';
import { $, connectDesktopClose, connectImport, createManuscript, documentURL, errorMessage, exportBytes, fileName } from './ui.js';

const store = libraryStore();
const open = id => { location.href = documentURL(id); };
const showError = message => {
  $('library-error').textContent = message;
  $('library-error').hidden = false;
};
let manuscripts = [];
let pendingDelete;
let undoDelete;

function cardMenu(item, title) {
  const menu = document.createElement('details');
  menu.className = 'card-menu';
  const trigger = document.createElement('summary');
  trigger.textContent = '⋯';
  trigger.setAttribute('aria-label', `Options for ${title}`);
  const options = document.createElement('div');
  options.className = 'card-menu-options';
  const exportButton = document.createElement('button');
  exportButton.textContent = 'Export as ScribeForge (.stf)';
  exportButton.addEventListener('click', async () => {
    menu.open = false;
    try {
      const latest = await store.get(item.id);
      if (!latest) throw new Error('This manuscript is no longer in the library.');
      const { current } = latest;
      await exportBytes(`${fileName(current.metadata.title)}.stf`, encodeManuscript(current), 'application/vnd.storyforge+json');
    } catch (error) { showError(`Could not export: ${errorMessage(error)}`); }
  });
  const deleteButton = document.createElement('button');
  deleteButton.textContent = 'Delete';
  deleteButton.className = 'delete-script';
  deleteButton.disabled = !item.revision;
  deleteButton.addEventListener('click', () => {
    menu.open = false;
    pendingDelete = item;
    $('delete-script-description').textContent = `Remove “${title}” from your manuscript library?`;
    $('delete-script-dialog').showModal();
  });
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of document.querySelectorAll('.card-menu[open]')) if (other !== menu) other.open = false;
  });
  options.append(exportButton, deleteButton);
  menu.append(trigger, options);
  return menu;
}

function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const shown = manuscripts.filter(item => `${item.metadata?.title ?? ''} ${item.metadata?.author ?? ''}`.toLocaleLowerCase().includes(query));
  $('script-grid').replaceChildren(...shown.map(item => {
    const card = document.createElement('article');
    card.className = 'script-card manuscript-card';
    const preview = document.createElement('button');
    preview.className = 'script-preview';
    preview.setAttribute('aria-label', `Open ${item.metadata?.title || 'Untitled Manuscript'}`);
    preview.addEventListener('click', () => open(item.id));
    for (const excerpt of item.preview?.filter(Boolean).slice(0, 4) ?? []) {
      const line = document.createElement('span');
      line.className = 'preview-prose';
      line.textContent = excerpt;
      preview.append(line);
    }
    if (!preview.childElementCount) {
      const blank = document.createElement('span');
      blank.className = 'blank-preview';
      blank.textContent = '✧';
      preview.append(blank);
    }
    const metadata = document.createElement('div');
    metadata.className = 'card-body card-metadata';
    const kind = document.createElement('span');
    kind.className = 'card-kind';
    kind.textContent = item.error ? 'RECOVERY NEEDED' : 'MANUSCRIPT';
    const title = document.createElement('button');
    title.className = 'card-title';
    title.textContent = item.metadata?.title || (item.error ? item.id : 'Untitled Manuscript');
    const detail = document.createElement('small');
    detail.textContent = item.error ?? (item.updated ? new Date(item.updated).toLocaleDateString() : '');
    title.addEventListener('click', () => open(item.id));
    metadata.append(cardMenu(item, title.textContent), kind, title, detail);
    card.append(preview, metadata);
    return card;
  }));
  $('library-count').textContent = `${shown.length} manuscript${shown.length === 1 ? '' : 's'}`;
  $('empty-state').hidden = Boolean(shown.length);
  $('empty-title').textContent = query ? 'No matching manuscripts.' : 'A room of your own.';
  $('empty-text').hidden = Boolean(query);
}

async function load() {
  try {
    manuscripts = (await store.list()).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    render();
    $('new-manuscript').disabled = false;
    $('import').disabled = false;
  } catch (error) { showError(errorMessage(error)); }
}
$('search').addEventListener('input', render);
$('new-manuscript').addEventListener('click', async () => {
  $('new-manuscript').disabled = true;
  try { open(await createManuscript(store)); }
  catch (error) { showError(errorMessage(error)); $('new-manuscript').disabled = false; }
});
$('cancel-delete-script').addEventListener('click', () => $('delete-script-dialog').close());
$('delete-script-dialog').addEventListener('close', () => { pendingDelete = null; });
$('confirm-delete-script').addEventListener('click', async event => {
  const item = pendingDelete;
  if (!item) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const revision = await store.archive(item.id, item.revision);
    undoDelete = { id: item.id, revision };
    $('delete-script-dialog').close();
    $('library-notice').hidden = false;
    await load();
  } catch (error) {
    $('delete-script-dialog').close();
    showError(errorMessage(error));
  } finally { button.disabled = false; }
});
$('undo-delete-script').addEventListener('click', async event => {
  if (!undoDelete) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await store.restore(undoDelete.id, undoDelete.revision);
    undoDelete = null;
    $('library-notice').hidden = true;
    await load();
  } catch (error) { showError(errorMessage(error)); }
  finally { button.disabled = false; }
});
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.card-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  for (const menu of document.querySelectorAll('.card-menu[open]')) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
setupLibraryStatistics($('writing-statistics'), store.list);
connectImport(store, open, showError);
connectDesktopClose(async () => {}, showError);
window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
void load();
