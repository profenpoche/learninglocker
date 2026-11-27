// Routes d'authentification. Code d'origine : legacy/api/src/controllers/AuthController.js et
// legacy/api/src/routes/HttpRoutes.js (section AUTHORIZATION, Google, /auth/jwt/success).
//
// Correctif de sécurité (D7) sans effet sur les requêtes légitimes : une valeur objet dans
// client_id, client_secret, email ou token n'est jamais passée à une requête MongoDB (elle y était
// interprétée comme un opérateur : `{"$ne": null}` permettait par exemple de réinitialiser le mot de
// passe d'un autre utilisateur ayant un jeton en cours).
import { randomUUID } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Next, Post, Req, Res } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import ms, { type StringValue } from 'ms';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';
import { API_CONFIG, LOGGER } from '../core/tokens.js';
import { MODELS } from '../db/db.module.js';
import type { Models } from '../db/models.js';
import { parseBody } from '../http/body.js';
import { catchErrors, Unauthorised } from '../http/request-errors.js';
import type { Mailer } from '../mail/mailer.js';
import { compareHash, hashLegacy } from '../security/bcrypt.js';
import type { AuthenticatedRequest } from './auth-info.js';
import type { JwtService } from './jwt.js';
import { authenticate } from './passport.js';
import { isQueryObject, readBasicCredentials, type Strategies } from './strategies.js';
import { JWT, MAILER, STRATEGIES } from './tokens.js';
import { legacyValidationError } from './validation-error.js';

type UserDoc = mongoose.HydratedDocument<Record<string, unknown>>;

/** api/auth/utils.js */
const AUTH_FAILURE = { USER_NOT_FOUND: 'USER_NOT_FOUND', PASSWORD_INCORRECT: 'PASSWORD_INCORRECT', LOCKED_OUT: 'LOCKED_OUT' } as const;
/** lib/constants/auth.js */
const ACCESS_TOKEN_VALIDITY_PERIOD_SEC = 3600;

interface LoginData {
  user: UserDoc | false;
  clearLockout: boolean;
  reason: string | null | undefined;
  success: boolean;
}

@Controller()
export class AuthController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MODELS) private readonly models: Models,
    @Inject(JWT) private readonly jwt: JwtService,
    @Inject(STRATEGIES) private readonly strategies: Strategies,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private refreshCookieOptions(protocol: string) {
    const validPeriodMsec = ms(this.config.jwtRefreshTokenExpiration as StringValue);
    return {
      path: '/api/auth/jwt/refresh',
      expires: new Date(Date.now() + validPeriodMsec),
      maxAge: validPeriodMsec,
      httpOnly: true,
      sameSite: 'strict' as const,
      ...(protocol === 'https' ? { secure: true } : {}),
    };
  }

  /** Stratégie userBasic (passport-http Basic + vérification bcrypt et verrouillage). */
  private async userBasic(req: AuthenticatedRequest): Promise<LoginData | false> {
    const credentials = readBasicCredentials(req);
    if (credentials.type !== 'credentials') return false;
    const info: LoginData = { user: false, clearLockout: false, reason: null, success: false };
    const user = await this.models.User.findOne({ email: credentials.userid });
    if (!user) {
      info.reason = AUTH_FAILURE.USER_NOT_FOUND;
      return info;
    }
    info.user = user;
    const settings = user.get('ownerOrganisationSettings') as { LOCKOUT_ENABLED?: unknown; LOCKOUT_SECONDS?: number; LOCKOUT_ATTEMPS?: number };
    if (settings.LOCKOUT_ENABLED) {
      const expiry = user.get('authLockoutExpiry') as Date | null | undefined;
      if (expiry) {
        const lockoutMs = (settings.LOCKOUT_SECONDS || 30) * 1000;
        const acceptExpiresSince = new Date(Date.now() - lockoutMs);
        if (expiry >= acceptExpiresSince) {
          info.reason = AUTH_FAILURE.LOCKED_OUT;
          return info;
        }
        info.clearLockout = true;
      }
    }
    info.success = await compareHash(credentials.password, user.get('password'));
    if (!info.success) info.reason = AUTH_FAILURE.PASSWORD_INCORRECT;
    return info;
  }

  /** POST /auth/jwt/password : connexion (Basic email:mot de passe) → JWT utilisateur et cookie de refresh. */
  @Post('auth/jwt/password')
  @HttpCode(200)
  async login(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const data = await this.userBasic(req);
    const authFailure = (reason: unknown, statusCode = 401) => {
      res.removeHeader('WWW-Authenticate');
      const message = reason === AUTH_FAILURE.USER_NOT_FOUND || reason === AUTH_FAILURE.PASSWORD_INCORRECT || reason === AUTH_FAILURE.LOCKED_OUT
        ? 'Incorrect login details'
        : `There was an error (code: ${String(reason)})`;
      res.status(statusCode).send({ success: false, message });
    };
    const user = data ? data.user : undefined;
    const save = async (doc: UserDoc) => {
      try { await doc.save(); } catch { /* le legacy ignorait l'erreur d'enregistrement */ }
    };

    if (!data || !data.success || !user) {
      if (user) {
        if (data && data.clearLockout) {
          user.set('authLockoutExpiry', null);
          user.set('authFailedAttempts', 0);
        }
        user.set('authFailedAttempts', (user.get('authFailedAttempts') as number) + 1);
        const settings = user.get('ownerOrganisationSettings') as { LOCKOUT_ATTEMPS?: number };
        if (!user.get('authLockoutExpiry') && (user.get('authFailedAttempts') as number) >= (settings.LOCKOUT_ATTEMPS as number)) {
          user.set('authLockoutExpiry', new Date());
        }
        user.set('authLastAttempt', new Date());
        await save(user);
      }
      authFailure(data ? data.reason : undefined);
      return;
    }

    user.set('authLockoutExpiry', null);
    user.set('authFailedAttempts', 0);
    user.set('authLastAttempt', new Date());
    await save(user);
    try {
      const [accessToken, refreshToken] = await Promise.all([this.jwt.createUserJWT(user), this.jwt.createUserRefreshJWT(user)]);
      res.cookie(`refresh_token_user_${String(user._id)}`, refreshToken, this.refreshCookieOptions(req.protocol))
        .set('Content-Type', 'text/plain')
        .send(accessToken);
    } catch (error) {
      authFailure(error);
    }
  }

  /** POST /auth/jwt/organisation : JWT d'organisation et cookie de refresh, pour un utilisateur membre. */
  @Post('auth/jwt/organisation')
  @HttpCode(200)
  async organisation(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const user = await authenticate(this.strategies, ['jwt'], req, res);
    if (!user) return;
    const organisationId = (req.body as Record<string, unknown>).organisation;
    const organisations = user.organisations as { toString(): string }[];
    const provider = user.authInfo?.token?.provider;
    if (organisations.filter((id) => String(id) === organisationId).length !== 0) {
      const doc = user as unknown as UserDoc;
      try {
        const [orgAccessToken, orgRefreshToken] = await Promise.all([
          this.jwt.createOrgJWT(doc, organisationId, provider),
          this.jwt.createOrgRefreshJWT(doc, organisationId, provider),
        ]);
        res.cookie(`refresh_token_organisation_${String(organisationId)}`, orgRefreshToken, this.refreshCookieOptions(req.protocol))
          .set('Content-Type', 'text/plain')
          .send(orgAccessToken);
      } catch (error) {
        res.status(500).send(error);
      }
    } else {
      res.status(401).send('User does not have access to this organisation.');
    }
  }

  /** POST /auth/jwt/refresh : nouveau JWT d'accès depuis le cookie de refresh (pas de rotation). */
  @Post('auth/jwt/refresh')
  @HttpCode(200)
  async refresh(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    await catchErrors(res, this.logger, this.config.log.level, async () => {
      try {
        const body = req.body as Record<string, unknown>;
        const refreshToken = (req.cookies as Record<string, unknown>)[`refresh_token_${String(body.tokenType)}_${String(body.id)}`];
        const { tokenId, tokenType, userId, provider } = this.jwt.verify(refreshToken);
        const user = await this.models.User.findOne({ _id: userId });
        if (!user) throw new Unauthorised();
        if (tokenType === 'user_refresh') {
          res.status(200).set('Content-Type', 'text/plain').send(await this.jwt.createUserJWT(user, provider));
        } else if (tokenType === 'organisation_refresh') {
          res.status(200).set('Content-Type', 'text/plain').send(await this.jwt.createOrgJWT(user, tokenId, provider));
        } else {
          throw new Unauthorised();
        }
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        if (name === 'JsonWebTokenError' || name === 'TokenExpiredError') throw new Unauthorised();
        throw error;
      }
    });
  }

  /** GET /auth/client/info : titre, organisation, store et scopes du client Basic. */
  @Get('auth/client/info')
  async clientInfo(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const user = await authenticate(this.strategies, ['clientBasic'], req, res);
    if (!user) return;
    const client = user.authInfo?.client ?? {} as Record<string, unknown>;
    res.status(200).send({ title: client.title, organisation: client.organisation, lrs_id: client.lrs_id, scopes: client.scopes });
  }

  /**
   * GET /auth/jwt/google et /auth/jwt/google/callback. Routes enregistrées par le legacy seulement si
   * GOOGLE_ENABLED est une chaîne non vide (« false » compris). Sans GOOGLE_CLIENT_ID et
   * GOOGLE_CLIENT_SECRET, la stratégie n'existe pas : erreur 500 d'Express, comme le legacy.
   * Le flux Google complet (OIDC) n'est pas encore porté : configuré, il passe par le relais.
   */
  @Get(['auth/jwt/google', 'auth/jwt/google/callback'])
  google(@Next() next: NextFunction): void {
    const { googleEnabledRaw, googleClientId, googleClientSecret } = this.config;
    if (!googleEnabledRaw || (googleClientId && googleClientSecret)) {
      next();
      return;
    }
    throw new Error('Unknown authentication strategy "google"');
  }

  /** GET /auth/jwt/success : page de fin du flux Google (jeton dans ?access_token=). */
  @Get('auth/jwt/success')
  async success(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const user = await authenticate(this.strategies, ['jwt'], req, res);
    if (!user) return;
    res.send('Login success!');
  }

  /** POST /oauth2/token : jeton opaque client_credentials (destiné au service xAPI). */
  @Post('oauth2/token')
  @HttpCode(200)
  async oauth2Token(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const body = req.body as Record<string, unknown>;
    const { grant_type: grantType, client_id: clientId, client_secret: clientSecret } = body;
    if (grantType === undefined || clientId === undefined || clientSecret === undefined) {
      res.status(400).send({ error: 'invalid_request' });
      return;
    }
    if (grantType !== 'client_credentials') {
      res.status(400).send({ error: 'unsupported_grant_type' });
      return;
    }
    let client;
    try {
      client = isQueryObject(clientId) || isQueryObject(clientSecret)
        ? null
        : await this.models.Client.findOne({ 'api.basic_key': clientId, 'api.basic_secret': clientSecret, isTrusted: true });
    } catch (error) {
      res.status(500).send(error);
      return;
    }
    if (!client) {
      res.status(400).send({ error: 'invalid_client' });
      return;
    }
    const accessToken = randomUUID();
    const createdAt = new Date();
    const expireAt = new Date(createdAt.getTime());
    expireAt.setSeconds(createdAt.getSeconds() + ACCESS_TOKEN_VALIDITY_PERIOD_SEC);
    try {
      await this.models.OAuthToken.create({ clientId: client._id, accessToken, createdAt, expireAt });
    } catch (error) {
      res.status(500).send(error);
      return;
    }
    res.status(200).send({ access_token: accessToken, token_type: 'bearer', expires_in: ACCESS_TOKEN_VALIDITY_PERIOD_SEC });
  }

  /** POST /auth/resetpassword/request : 204 dans tous les cas ; jeton bcrypt(email) valable 24 h, envoyé par courriel. */
  @Post('auth/resetpassword/request')
  @HttpCode(200)
  async resetPasswordRequest(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const { email } = req.body as Record<string, unknown>;
    const user = isQueryObject(email) ? null : await this.models.User.findOne({ email });
    if (!user) {
      res.status(204).send();
      return;
    }
    const token = { token: await hashLegacy(String(user.get('email'))), expires: new Date(Date.now() + 24 * 3600 * 1000) };
    (user.get('resetTokens') as unknown[]).push(token);
    try {
      await user.save();
    } catch (error) {
      this.logger.error('Password reset error', error);
      res.status(500).send({ message: 'There was an issue. Please try again' });
      return;
    }
    this.mailer.sendResetPasswordToken({ name: user.get('name'), email: user.get('email') }, token);
    res.status(204).send();
  }

  /**
   * POST /auth/resetpassword/reset : nouveau mot de passe avec un jeton valide.
   * Réponse identique au legacy : le document utilisateur complet (empreinte comprise, anomalie
   * docs/03 §7.1, à corriger avec les autres failles de la décision D7).
   */
  @Post('auth/resetpassword/reset')
  @HttpCode(200)
  async resetPassword(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await parseBody(req, res);
    const { email, token, password } = req.body as Record<string, unknown>;
    // `password.length` : sans mot de passe, TypeError → 500 d'Express, comme le legacy.
    if ((password as { length: number }).length === 0) {
      res.status(400).send({ message: 'You must enter a password' });
      return;
    }
    const user = isQueryObject(email) || isQueryObject(token)
      ? null
      : await this.models.User.findOne({ email, 'resetTokens.token': token, 'resetTokens.expires': { $gt: new Date() } });
    if (!user) {
      res.status(404).send({ message: 'Invalid password reset token. Please submit a new request' });
      return;
    }
    user.set('resetTokens', []);
    user.set('password', password);
    try {
      const saved = await user.save();
      res.send(saved);
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      res.status(typeof statusCode === 'number' ? statusCode : 400);
      res.send(error instanceof mongoose.Error.ValidationError ? legacyValidationError(error) : error);
    }
  }
}
