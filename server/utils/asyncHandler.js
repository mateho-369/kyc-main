/**
 * Async route handler wrapper.
 *
 * Express 4 does not catch rejected promises returned by async handlers.
 * When an async handler throws (including inside its own catch block),
 * no response is ever sent and the request hangs until the reverse proxy
 * times out with a 504. Wrapping the handler forwards the rejection to
 * next(err) so the global error handler can respond.
 *
 * Usage:
 *   router.post('/path', asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
