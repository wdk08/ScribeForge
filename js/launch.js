// A classic script can explain local-file limitations even if ES modules fail.
if (location.protocol === 'file:') {
  const notice = document.createElement('section');
  notice.className = 'startup-error'; notice.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'ScriptForge was opened as a local HTML file. Use the localhost app for reliable file opening and a shared recent library. Existing browser documents are preserved; local-file records are not automatically moved to localhost. Save any work here before switching.';
  const open = document.createElement('a');
  open.href = 'http://localhost:4173/'; open.target = '_blank'; open.rel = 'noopener';
  open.textContent = 'Open ScriptForge';
  notice.append(text, open); document.querySelector('header')?.after(notice);
}
