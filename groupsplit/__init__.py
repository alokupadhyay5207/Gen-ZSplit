"""Gen-ZSplit group module.  Wire it up with ``groupsplit.init_app(app)``."""
from flask import Flask

from db import DEFAULT_DB_PATH, close_db

from . import filters
from .routes import bp
from .security import csrf_token


def init_app(app: Flask) -> None:
    app.config.setdefault("DATABASE", DEFAULT_DB_PATH)
    app.teardown_appcontext(close_db)
    app.jinja_env.globals["csrf_token"] = csrf_token
    filters.register(app)
    app.register_blueprint(bp)
