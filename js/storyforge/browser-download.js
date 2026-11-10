export const releasePage = 'https://github.com/wdk08/StoryForge/releases/latest';
export const releaseAPI = 'https://api.github.com/repos/wdk08/StoryForge/releases/latest';

const installerTypes = [
  { key: 'macArm', label: 'macOS — Apple Silicon', extension: /\.dmg$/i, arch: /(?:^|[_\s.-])(?:aarch64|arm64)(?=[_\s.-]|$)/i },
  { key: 'macIntel', label: 'macOS — Intel', extension: /\.dmg$/i, arch: /(?:^|[_\s.-])(?:x64|x86_64|amd64)(?=[_\s.-]|$)/i },
  { key: 'windows', label: 'Windows — x64', extension: /\.exe$/i, arch: /(?:^|[_\s.-])(?:x64|x86_64|amd64)(?=[_\s.-]|$)/i },
];

export function releaseInstallers(release) {
  if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('A stable published release is required.');
  }
  const assets = (release.assets ?? []).filter(asset => asset.state === 'uploaded' && asset.size > 0);
  return Object.fromEntries(installerTypes.map(({ key, extension, arch }) => {
    const matches = assets.filter(asset => extension.test(asset.name) && arch.test(asset.name));
    if (matches.length !== 1) throw new Error('Installer downloads could not be identified safely.');
    const { name, browser_download_url: href } = matches[0];
    const url = new URL(href);
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://github.com' ||
      path !== `/wdk08/StoryForge/releases/download/${release.tag_name}/${name}` ||
      url.username || url.password || url.search || url.hash) {
      throw new Error('Unexpected installer download location.');
    }
    return [key, url.href];
  }));
}

export function installerPreference(platform, architecture) {
  if (/win/i.test(platform) && !/darwin/i.test(platform)) return 'windows';
  if (/mac|darwin/i.test(platform)) {
    if (/^arm(?:64)?$|^aarch64$/i.test(architecture)) return 'macArm';
    if (/^x86(?:_64)?$|^x64$/i.test(architecture)) return 'macIntel';
  }
  return null;
}

export function setupBrowserDownload(environment = window) {
  if (environment.__TAURI__) return;
  const { document, navigator } = environment;
  const container = document.querySelector('.header-actions') ?? document.querySelector('header');
  if (!container) return;
  const menu = document.createElement('details');
  menu.className = 'browser-download';
  const summary = document.createElement('summary');
  summary.textContent = 'Download';
  summary.className = 'quiet-button';
  const options = document.createElement('div');
  options.className = 'export-options';
  const link = (label, href) => {
    const anchor = document.createElement('a');
    anchor.textContent = label;
    anchor.href = href;
    anchor.rel = 'noopener';
    return anchor;
  };
  const fallback = link('View StoryForge releases', releasePage);
  fallback.target = '_blank';
  options.append(fallback);
  menu.append(summary, options);
  container.append(menu);

  let busy = false;
  let loaded = false;
  menu.addEventListener('toggle', async () => {
    if (!menu.open || busy || loaded) return;
    busy = true;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Loading downloads…';
    options.replaceChildren(status, fallback);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await environment.fetch(releaseAPI, {
        headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('Installer downloads are currently unavailable.');
      const links = releaseInstallers(await response.json());
      const hints = navigator.userAgentData;
      const platform = hints?.platform || navigator.platform || navigator.userAgent;
      let architecture;
      try {
        architecture = (await hints?.getHighEntropyValues?.(['architecture']))?.architecture;
      } catch { /* The browser may withhold architecture. Keep both macOS choices. */ }
      const preferred = installerPreference(platform, architecture);
      const ordered = preferred ? [...installerTypes.filter(type => type.key === preferred),
        ...installerTypes.filter(type => type.key !== preferred)] : installerTypes;
      options.replaceChildren(...ordered.map(({ key, label }) => link(label, links[key])), fallback);
      loaded = true;
    } catch {
      status.textContent = 'Installer downloads are currently unavailable. Close and reopen Download to retry.';
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      summary.focus();
    }
  });
}
