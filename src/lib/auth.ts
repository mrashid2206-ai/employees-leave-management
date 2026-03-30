import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'employees-secret-key-2026-do-not-share')

const USERS = [
  { username: 'mrashid', password: 'Mrashid@1981', role: 'admin', name: 'م. راشد' },
]

export async function authenticate(username: string, password: string) {
  const user = USERS.find(u => u.username === username && u.password === password)
  if (!user) return null

  const token = await new SignJWT({ username: user.username, role: user.role, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(SECRET)

  return { token, user: { username: user.username, role: user.role, name: user.name } }
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as { username: string; role: string; name: string }
  } catch {
    return null
  }
}

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  if (!token) return null
  return verifyToken(token)
}
