// pages.dev gives the app a URL without the account subdomain; the real app lives in the `fondo` worker.
export default {
  fetch: (request, env) => env.APP.fetch(request),
};
