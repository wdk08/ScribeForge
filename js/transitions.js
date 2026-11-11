const commonTransition = /^(?:fade\s+in|fade\s+out|fade\s+to\s+black|fade\s+to\s+white|cut\s+to|dissolve\s+to|smash\s+cut\s+to|match\s+cut\s+to|jump\s+cut\s+to|hard\s+cut\s+to|wipe\s+to|iris\s+(?:in|out))\s*[:.]?$/i;
export const isCommonTransition = text => commonTransition.test(text.trim());
export const transitionClass = el => el.type === 'transition' && /^fade\s+in\s*[:.]?$/i.test(el.text.trim()) ? 'transition-left' : '';
