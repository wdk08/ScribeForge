/** Inline AST. Text stays Fountain, and no untrusted HTML is generated. */
export function parseInline(text) {
  const nodes = [];
  const append = value => {
    if (!value) return;
    if (nodes.at(-1)?.type === 'text') nodes.at(-1).text += value;
    else nodes.push({ type: 'text', text: value });
  };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && /[\\*_\[\]]/.test(text[i + 1] ?? '')) {
      append(text[i + 1]); i += 2; continue;
    }
    const hidden = text.startsWith('[[', i) ? ['note', ']]'] : text.startsWith('/*', i) ? ['boneyard', '*/'] : null;
    if (hidden) {
      const end = text.indexOf(hidden[1], i + 2);
      const body = text.slice(i + 2, end);
      if (end !== -1 && (hidden[0] === 'boneyard' || !/(?:\r\n|\r|\n){2}/.test(body))) {
        nodes.push({ type: hidden[0], text: body }); i = end + 2; continue;
      }
    }
    const marker = ['***', '**', '*', '_'].find(m => text.startsWith(m, i));
    if (marker && text[i + marker.length] && !/\s/.test(text[i + marker.length])) {
      let end = i + marker.length;
      while ((end = text.indexOf(marker, end)) !== -1) {
        let slashes = 0;
        for (let p = end - 1; p >= 0 && text[p] === '\\'; p--) slashes++;
        if (slashes % 2 === 0 && !/\s/.test(text[end - 1])) {
          // A bold span may close immediately after nested italics: **a *b***.
          if (marker === '**' && text.startsWith('***', end)) end++;
          break;
        }
        end += marker.length;
      }
      if (end !== -1 && !/[\r\n]/.test(text.slice(i, end))) {
        nodes.push({ type: marker === '_' ? 'underline' : marker === '*' ? 'italic' : marker === '**' ? 'bold' : 'boldItalic', children: parseInline(text.slice(i + marker.length, end)) });
        i = end + marker.length; continue;
      }
    }
    append(text[i++]);
  }
  return nodes;
}
