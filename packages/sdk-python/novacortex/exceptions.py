class NovaCortexError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class AuthError(NovaCortexError):
    pass


class NotFoundError(NovaCortexError):
    pass


class ValidationError(NovaCortexError):
    pass


class ServerError(NovaCortexError):
    pass
