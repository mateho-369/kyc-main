const asyncHandler = require('./asyncHandler');

/**
 * Wraps an Express Router so every async handler registered on it is
 * automatically passed through asyncHandler().
 *
 * Express 4 does not catch rejected promises returned by async handlers.
 * When one throws — including inside its own catch block — no response is
 * ever sent and the request hangs until the reverse proxy times out with a
 * 504. Rather than editing every route individually, this patches the
 * router's registration methods once per file.
 *
 * Usage:
 *   const router = wrapRouter(express.Router());
 *
 * Not wrapped:
 *   - non-async functions (nothing to catch)
 *   - error handlers, i.e. arity 4 — wrapping would change (err, req, res, next)
 *     into a normal middleware and break error propagation
 *   - handlers already returned by asyncHandler (they are not AsyncFunction)
 */
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all', 'use'];

const isAsyncFn = (fn) =>
  typeof fn === 'function' &&
  fn.constructor &&
  fn.constructor.name === 'AsyncFunction';

const wrapArg = (arg) => {
  if (Array.isArray(arg)) return arg.map(wrapArg);
  // arity 4 === Express error handler, must keep its signature
  if (isAsyncFn(arg) && arg.length < 4) return asyncHandler(arg);
  return arg;
};

function wrapRouter(router) {
  for (const method of METHODS) {
    if (typeof router[method] !== 'function') continue;
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrapArg));
  }
  return router;
}

module.exports = wrapRouter;
