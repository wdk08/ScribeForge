import { detectedCharacters, previewCharacterRename } from './characters.js';

export function setupCharacterRename({ launcher, getDocument, onRename, onReturn }) {
  const dialog = document.createElement('dialog'); dialog.id = 'character-rename-dialog'; dialog.setAttribute('aria-labelledby', 'cr-title');
  dialog.innerHTML = `<span class="eyebrow">THIS SCREENPLAY</span><h1 id="cr-title">Rename Character</h1>
    <form id="cr-form"><label>Character<select id="cr-character" required></select></label><label>New Name<input id="cr-name" maxlength="100" required autocomplete="off"></label><p class="dialog-note">Choose a detected character. Next, review cues and individual text mentions before changing anything.</p><div class="dialog-actions"><button id="cr-cancel" type="button" class="secondary-button">Cancel</button><button id="cr-review" class="primary-button">Rename Character…</button></div></form>
    <section id="cr-review-panel" hidden><h2 id="cr-question"></h2><p id="cr-counts" aria-live="polite"></p><p class="dialog-note">All matching character cues will be renamed, preserving extensions and dual dialogue. Review text mentions below and uncheck any that mean something else. Notes, comments, and title metadata are kept.</p><div class="cr-selection"><button id="cr-select-all" class="quiet-button">Select all mentions</button><button id="cr-select-none" class="quiet-button">Deselect all mentions</button></div><div id="cr-matches" role="group" aria-label="Review text mentions"></div><div class="dialog-actions"><button id="cr-back" class="secondary-button">Back</button><button id="cr-review-cancel" class="secondary-button">Cancel</button><button id="cr-confirm" class="primary-button">Rename</button></div></section><p id="cr-error" role="alert" hidden></p>`;
  document.body.append(dialog); const $ = id => dialog.querySelector(`#${id}`); let plan, applying = false, original;
  const error = message => { $('cr-error').textContent = message; $('cr-error').hidden = !message; };
  const selected = () => [...$('cr-matches').querySelectorAll('input:checked')].map(input => input.value);
  function counts() { const n = selected().length; $('cr-counts').textContent = `Character cues: ${plan.cues.length} · Other mentions: ${n} of ${plan.mentions.length} selected. This will update ${plan.cues.length + n} occurrences.`; }
  function close() { if (!applying) dialog.close(); }
  function open() {
    if (dialog.open || !getDocument()) return;
    original = JSON.stringify(getDocument()); const characters = detectedCharacters(getDocument());
    $('cr-character').replaceChildren(...characters.map(character => new Option(character.name, character.name)));
    $('cr-name').value = ''; $('cr-form').hidden = false; $('cr-review-panel').hidden = true; $('cr-matches').replaceChildren(); plan = null; error(characters.length ? '' : 'No character cues have been detected in this screenplay yet.'); $('cr-review').disabled = !characters.length;
    dialog.showModal(); (characters.length ? $('cr-character') : $('cr-cancel')).focus();
  }
  $('cr-form').addEventListener('submit', event => {
    event.preventDefault(); error('');
    try {
      if (original !== JSON.stringify(getDocument())) throw new Error('The screenplay changed while this dialog was open. Close it and review again.');
      plan = previewCharacterRename(getDocument(), $('cr-character').value, $('cr-name').value);
      $('cr-question').textContent = `Rename ${plan.from} to ${plan.to}?`;
      const tree = document.createDocumentFragment();
      for (const [index, match] of plan.mentions.entries()) {
        const label = document.createElement('label'); label.className = 'cr-match';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = match.id; checkbox.setAttribute('aria-label', `Replace mention ${index + 1}: ${match.before} with ${match.after}`); checkbox.addEventListener('change', counts);
        const body = document.createElement('span'), title = document.createElement('strong'); title.textContent = `${match.before} → ${match.after}`;
        const snippet = document.createElement('small'), highlight = document.createElement('mark'); highlight.textContent = match.context.slice(match.start, match.end);
        snippet.append(`${match.type} · …${match.context.slice(Math.max(0, match.start - 65), match.start).replace(/\s+/g, ' ')}`, highlight, `${match.context.slice(match.end, Math.min(match.context.length, match.end + 85)).replace(/\s+/g, ' ')}…`);
        body.append(title, snippet); label.append(checkbox, body); tree.append(label);
      }
      if (!plan.mentions.length) { const empty = document.createElement('p'); empty.className = 'dialog-note'; empty.textContent = 'No additional text mentions found.'; tree.append(empty); }
      $('cr-matches').replaceChildren(tree); counts(); $('cr-form').hidden = true; $('cr-review-panel').hidden = false; $('cr-confirm').focus();
    } catch (failure) { error(failure.message); }
  });
  for (const id of ['cr-cancel', 'cr-review-cancel']) $(id).addEventListener('click', close);
  $('cr-back').addEventListener('click', () => { if (applying) return; error(''); $('cr-form').hidden = false; $('cr-review-panel').hidden = true; $('cr-name').focus(); });
  for (const [id, checked] of [['cr-select-all', true], ['cr-select-none', false]]) $(id).addEventListener('click', () => { for (const input of $('cr-matches').querySelectorAll('input')) input.checked = checked; counts(); });
  $('cr-confirm').addEventListener('click', async () => {
    if (applying || !plan) return; applying = true; error(''); $('cr-confirm').textContent = 'Renaming…';
    for (const button of dialog.querySelectorAll('button,input')) button.disabled = true;
    try { await onRename({ type: 'renameCharacter', from: plan.from, to: plan.to, mentions: selected(), signature: plan.signature }); applying = false; dialog.close(); }
    catch (failure) { error(`Rename was not applied: ${failure.message}`); }
    finally { applying = false; $('cr-confirm').textContent = 'Rename'; for (const button of dialog.querySelectorAll('button,input')) button.disabled = false; }
  });
  dialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
  dialog.addEventListener('close', () => { plan = null; onReturn(); });
  launcher.addEventListener('click', open);
  return { open };
}
