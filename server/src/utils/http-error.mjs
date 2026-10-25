export const createHttpError = (status, code, message, extra = {}) =>
  Object.assign(new Error(message), { status, code, ...extra })
