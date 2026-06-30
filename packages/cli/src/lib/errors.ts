export abstract class CliError extends Error {
  abstract readonly exitCode: number;
  abstract readonly code: string;
}

export class ProfileNotFoundError extends CliError {
  readonly exitCode = 2;
  readonly code = 'profile_not_found';
}

export class NotLoggedInError extends CliError {
  readonly exitCode = 2;
  readonly code = 'not_logged_in';
}

export class InvalidTokenError extends CliError {
  readonly exitCode = 3;
  readonly code = 'invalid_token';
}

export class InsufficientScopeError extends CliError {
  readonly exitCode = 3;
  readonly code = 'insufficient_scope';
  constructor(message: string, public readonly required: string[], public readonly granted: string[]) {
    super(message);
  }
}

export class ServerUnreachableError extends CliError {
  readonly exitCode = 4;
  readonly code = 'server_unreachable';
}

export class ConfigCorruptedError extends CliError {
  readonly exitCode = 5;
  readonly code = 'config_corrupted';
}

export class BootstrapExpiredError extends CliError {
  readonly exitCode = 6;
  readonly code = 'bootstrap_expired';
}

export class BootstrapAlreadyUsedError extends CliError {
  readonly exitCode = 6;
  readonly code = 'bootstrap_already_used';
}

export class UnsupportedServerError extends CliError {
  readonly exitCode = 7;
  readonly code = 'unsupported_server';
}
