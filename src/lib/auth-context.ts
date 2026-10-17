// Which identity a request is made as, when the browser holds both sessions.
//
// An admin who is also an employee (HR staff, say) can be signed into the dashboard and the
// employee portal in the same browser, so both cookies arrive on every request.
// verifyAnyAuth used to take the admin cookie whenever present, which meant the portal's
// "my" requests were answered as the admin: the bell came back empty, and the employee's
// own lists ("my permissions", "my corrections", "my tardiness") came back as everyone's.
//
// The portal sends this header on its requests; verifyAnyAuth then authenticates the
// employee session only. Admin pages don't send it and behave as before. It can only
// narrow access (to the caller's own employee session), never widen it.
//
// Plain constants with no server imports, so client code can use them.
export const AUTH_CONTEXT_HEADER = 'x-auth-context'
export const EMPLOYEE_CONTEXT = 'employee'
