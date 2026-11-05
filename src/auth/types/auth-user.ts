/**
 * Shape of the user attached to an authenticated request/socket.
 *
 * This is intentionally small: it contains only what authorization checks need.
 * Never put the password hash (or any secret) in the JWT or in `request.user`.
 */
export interface AuthUser {
  id: number;
  username: string;
}

/**
 * Claims stored inside the signed JWT.
 *
 * `sub` ("subject") is the standard JWT claim for the user id. `iat` and `exp`
 * are added automatically by jsonwebtoken when the token is signed.
 */
export interface JwtPayload {
  sub: number;
  username: string;
  iat?: number;
  exp?: number;
}
