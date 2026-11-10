import { DOMSerializer, Fragment } from 'prosemirror-model';
import { isChapterStyle, paragraphFields, resolvedStyle, schema } from './model.js';

const serializer = DOMSerializer.fromSchema(schema);

export function formattedClipboard(view, getSettings) {
  return {
    serializeFragment(fragment, options, target) {
      const settings = getSettings();
      const typography = (node, style) => {
        if (!node.isInline) return node;
        let marks = node.marks;
        for (const name of ['font', 'size', 'color']) {
          const type = schema.marks[name];
          if (style[name] !== undefined && !type.isInSet(marks)) marks = type.create({ value: style[name] }).addToSet(marks);
        }
        for (const name of ['bold', 'italic', 'underline']) {
          const type = schema.marks[name];
          if (style[name] && !type.isInSet(marks) && !schema.marks[`un${name}`]?.isInSet(marks)) {
            marks = type.create().addToSet(marks);
          }
        }
        return node.mark(marks);
      };
      const from = view().state.selection.$from.parent.attrs;
      const fallback = resolvedStyle(from.style, settings);
      const nodes = [];
      fragment.forEach(node => {
        if (node.type !== schema.nodes.paragraph) { nodes.push(typography(node, fallback)); return; }
        const style = resolvedStyle(node.attrs.style, settings);
        const attrs = Object.fromEntries(Object.keys(paragraphFields).map(key => [key, node.attrs[key] ?? style[key]]));
        attrs.style = isChapterStyle(node.attrs.style, settings) ? 'chapter' : 'normal';
        const content = [];
        node.forEach(child => content.push(typography(child, style)));
        nodes.push(node.type.create(attrs, Fragment.fromArray(content)));
      });
      return serializer.serializeFragment(Fragment.fromArray(nodes), options, target);
    },
  };
}
