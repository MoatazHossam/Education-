// Minimal History API router. Links with a data-link attribute are handled
// client-side; everything else is a normal navigation.
const routes = [];
let renderFn = () => {};

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, handler });
}

export function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  renderFn();
}

export function startRouter(render) {
  renderFn = render;
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.origin !== location.origin) return;
    e.preventDefault();
    navigate(a.pathname + a.search);
  });
  window.addEventListener('popstate', render);
  render();
}
